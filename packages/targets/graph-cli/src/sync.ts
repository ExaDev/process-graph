import {
  assembleSync,
  type Gap,
  type GraphSourceClient,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import type { BoundActivity } from "@exadev/process-graph-store-contract";
import { CliError, failureOf } from "./errors.ts";
import { exitCodes } from "./exit-codes.ts";
import { callOptions, type GraphSession } from "./session.ts";

/** Finds the source that serves scopes with an identifier prefix, such as `github`. */
export type SourceLookup = (prefix: string) => GraphSourceClient | undefined;

/** What to sync. */
export interface SyncRequest {
  /** Source-qualified scope identifiers, such as `github:owner` or `github:owner/repo`, read in order. */
  readonly scopes: readonly string[];
  /** A cursor from an interrupted sync: the first source's sync continues after it. */
  readonly after?: string;
}

/** What a sync wrote. */
export interface SyncResult {
  readonly modelId: string;
  /** The revision the write took. */
  readonly revision: number;
  /** The participants, activities and transitions written, each identifier counted once. */
  readonly participants: number;
  readonly activities: number;
  readonly transitions: number;
  /** The parts of the scope the sources could not read, in the order they were met. */
  readonly gaps: readonly Gap[];
}

/** The scopes of one source, in the order given. */
interface SourceScopes {
  readonly prefix: string;
  readonly scopes: readonly string[];
}

const scopeSeparator = ":";

/** Groups scopes by their source prefix, keeping the order in which each prefix first appears. */
const bySource = (scopes: readonly string[]): readonly SourceScopes[] => {
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const separator = scope.indexOf(scopeSeparator);
    if (separator <= 0) {
      throw new CliError(
        exitCodes.usage,
        `"${scope}" is not a scope: write <source>:<scope>, such as github:owner/repo`,
      );
    }
    const prefix = scope.slice(0, separator);
    groups.set(prefix, [...(groups.get(prefix) ?? []), scope]);
  }

  return [...groups].map(([prefix, grouped]) => ({ prefix, scopes: grouped }));
};

/** Bound activities are the only elements a sync assembles, since a page's activities are bound by schema. */
const boundActivities = (pages: readonly SyncPage[]) => {
  const { model, overlay, gaps } = assembleSync(pages);
  const activities = model.elements.flatMap((element): BoundActivity[] =>
    element.kind === "activity" && element.source !== undefined
      ? [{ ...element, source: element.source }]
      : [],
  );

  return {
    items: {
      participants: model.participants,
      activities,
      transitions: model.transitions,
      overlay,
    },
    gaps,
  };
};

/**
 * Reads every page of the scopes from their sources and merges them into the session's model in one write, creating the model when the store has none. Records already in the model are replaced by identifier and the rest are kept, so syncing again refreshes what changed.
 *
 * When a source fails part way, the pages read before the failure are still written, and the error says how to resume: the failing source's scopes with `--after` and the cursor of its last page read.
 * @param session - The store and model.
 * @param sources - The source for each identifier prefix.
 * @param request - The scopes, and a cursor to resume after.
 * @returns What was written, and the gaps the sources reported.
 * @throws CliError with `usage` for a scope with no source prefix, a prefix no source serves, or `after` with scopes of more than one source; and with the source's failure, the resume command added, when a source refuses the sync.
 */
export const sync = async (
  session: GraphSession,
  sources: SourceLookup,
  request: SyncRequest,
): Promise<SyncResult> => {
  const groups = bySource(request.scopes);
  if (request.after !== undefined && groups.length > 1) {
    throw new CliError(
      exitCodes.usage,
      "--after resumes one source's sync: give only that source's scopes",
    );
  }
  const clients = groups.map((group) => {
    const client = sources(group.prefix);
    if (client === undefined) {
      throw new CliError(
        exitCodes.usage,
        `no source reads "${group.prefix}" scopes`,
      );
    }

    return { ...group, client };
  });

  const pages: SyncPage[] = [];
  const write = async () => {
    const { items, gaps } = boundActivities(pages);
    const { revision } = await session.store.v1.items.upsert(
      { modelId: session.modelId, items },
      callOptions(session.signal),
    );

    return {
      modelId: session.modelId,
      revision,
      participants: items.participants.length,
      activities: items.activities.length,
      transitions: items.transitions.length,
      gaps,
    };
  };

  /** Reads the sources in order, each only after the one before has finished, since a source's failure must stop the ones after it. */
  const readFrom = async (index: number): Promise<void> => {
    const group = clients.at(index);
    if (group === undefined) {
      return;
    }
    let cursor = index === 0 ? request.after : undefined;
    try {
      const stream = await group.client.v1.sync.stream(
        cursor === undefined
          ? { scope: group.scopes }
          : { scope: group.scopes, after: cursor },
        callOptions(session.signal),
      );
      for await (const page of stream) {
        pages.push(page);
        cursor = page.next;
      }
    } catch (error) {
      const failure = failureOf(error);
      const saved = pages.length > 0;
      if (saved) {
        await write();
      }
      const later = clients.slice(index + 1).flatMap((next) => next.scopes);
      throw new CliError(
        failure.exitCode,
        [
          failure.message,
          ...(saved ? ["the pages read before the failure are saved"] : []),
          `resume with: sync ${group.scopes.join(" ")}${cursor === undefined ? "" : ` --after ${cursor}`}`,
          ...(later.length === 0 ? [] : [`then: sync ${later.join(" ")}`]),
        ].join("\n"),
        { cause: error },
      );
    }
    await readFrom(index + 1);
  };
  await readFrom(0);

  return write();
};
