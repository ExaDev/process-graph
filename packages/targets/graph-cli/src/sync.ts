import {
  assembleSync,
  type Gap,
  type GraphSourceClient,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import type { BoundActivity } from "@exadev/process-graph-store-contract";
import { CliError, failureOf, underlyingCause } from "./errors.ts";
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

/** Where a sync a source interrupted carries on, as data a host acts on; the command line renders it as the commands to run. */
export interface SyncInterruption {
  /** The request that continues the failing source: its scopes, after the cursor of the last page read from it, or from the start when none was read. */
  readonly resume: SyncRequest;
  /** The scopes of the sources after the failing one, which were not read; sync them afresh once `resume` has finished. */
  readonly remaining: readonly string[];
  /** Whether pages read before the failure were written to the model. */
  readonly saved: boolean;
}

/**
 * Thrown by `sync` when a source fails part way. Its exit status and message are the source's failure, classified as `failureOf` classifies it; its cause is the error underneath that failure, such as the token port's own error; and what to run next is data, in `resume` and `remaining`, never text.
 */
export class SyncInterruptedError extends CliError implements SyncInterruption {
  readonly resume: SyncRequest;

  readonly remaining: readonly string[];

  readonly saved: boolean;

  /**
   * @param exitCode - The exit status the source's failure maps to.
   * @param message - The source's failure.
   * @param interruption - Where the sync carries on.
   * @param options - The underlying error, kept as the cause.
   */
  constructor(
    exitCode: CliError["exitCode"],
    message: string,
    interruption: SyncInterruption,
    options?: ErrorOptions,
  ) {
    super(exitCode, message, options);
    this.name = "SyncInterruptedError";
    this.resume = interruption.resume;
    this.remaining = interruption.remaining;
    this.saved = interruption.saved;
  }
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
 * When a source fails part way, the pages read before the failure are still written, and the error carries where to carry on: the request that resumes the failing source after the cursor of its last page read, and the scopes of the sources not reached.
 * @param session - The store and model.
 * @param sources - The source for each identifier prefix.
 * @param request - The scopes, and a cursor to resume after.
 * @returns What was written, and the gaps the sources reported.
 * @throws CliError with `usage` for a scope with no source prefix, a prefix no source serves, or `after` with scopes of more than one source; and SyncInterruptedError, with the source's failure and where to carry on, when a source fails part way.
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
      throw new SyncInterruptedError(
        failure.exitCode,
        failure.message,
        {
          resume:
            cursor === undefined
              ? { scopes: group.scopes }
              : { scopes: group.scopes, after: cursor },
          remaining: clients.slice(index + 1).flatMap((next) => next.scopes),
          saved,
        },
        { cause: underlyingCause(error) },
      );
    }
    await readFrom(index + 1);
  };
  await readFrom(0);

  return write();
};
