import type {
  Gap,
  GraphSourceClient,
  SourceTransition,
  SyncPage,
} from "@exadev/process-graph-source-contract";
import type { GraphStoreClient } from "@exadev/process-graph-store-contract";
import { ORPCError } from "@orpc/client";
import type { SyncCheckpoint } from "./sync-record.ts";

/** Finds the source that reads scopes with an identifier prefix, such as `github`. */
export type SourceLookup = (prefix: string) => GraphSourceClient | undefined;

/** How far a sync has got. */
export interface SyncProgress {
  /** Pages read and written. */
  readonly pages: number;
  /** Distinct bound activities written. */
  readonly activities: number;
  /** Distinct transitions written. */
  readonly transitions: number;
  /** The parts of the scope the sources could not read, in the order met. */
  readonly gaps: readonly Gap[];
  /** Where to resume; absent once every scope has been read. */
  readonly checkpoint: SyncCheckpoint | undefined;
}

/** What to sync and where to. */
export interface SyncRequest {
  readonly store: GraphStoreClient;
  readonly sources: SourceLookup;
  readonly modelId: string;
  readonly scopes: readonly string[];
  /** A checkpoint from an interrupted sync of the same model and scopes: the sync carries on from it. */
  readonly resume?: SyncCheckpoint | undefined;
  /** Ends the sync between or during reads; what was written stays written. */
  readonly signal: AbortSignal;
  /** Called after every page is written, with the progress so far. */
  readonly onProgress: (progress: SyncProgress) => void;
}

/** Thrown when a scope names a source the app has no reader for. */
export class UnknownSourceError extends Error {
  /**
   * @param prefix - The source prefix no reader serves.
   */
  constructor(prefix: string) {
    super(`No source reads "${prefix}" scopes.`);
    this.name = "UnknownSourceError";
  }
}

const sourceSeparator = ":";

/** The scopes of each source, in the order each source first appears. */
const bySource = (
  scopes: readonly string[],
): readonly {
  readonly prefix: string;
  readonly scopes: readonly string[];
}[] => {
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const prefix = scope.slice(0, scope.indexOf(sourceSeparator));
    groups.set(prefix, [...(groups.get(prefix) ?? []), scope]);
  }

  return [...groups].map(([prefix, grouped]) => ({ prefix, scopes: grouped }));
};

/** The identifiers of the elements a model in the store already has, or none when the store has no such model. */
const storedElements = async (
  store: GraphStoreClient,
  modelId: string,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> => {
  try {
    const stored = await store.v1.models.load({ modelId }, { signal });

    return new Set(stored.model.elements.map((element) => element.id));
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") {
      return new Set();
    }
    throw error;
  }
};

/**
 * Reads the scopes from their sources page by page and writes each page into the model as soon as it is read, so progress is kept as it is made: a sync that is cancelled, rate limited or closed with the tab leaves everything it read in the store, and a checkpoint to carry on from.
 *
 * A store rejects a write that leaves a transition pointing at an element the model lacks, and a source may report a dependency on work a later page brings. A transition is therefore held back until the model has both of its ends, and written with the page that completes it. One whose end never arrives is written with the last page, where the store's rejection says which reference is missing.
 *
 * Relations a source reports (sub-issues, assignees, repository membership) have no place in the store and are not kept, as the command line's sync does.
 * @param request - The store, sources, model, scopes, an optional checkpoint, the signal and a progress listener.
 * @returns The final progress, with no checkpoint.
 * @throws UnknownSourceError for a scope whose source the app cannot read; an Error for a checkpoint naming a source none of the scopes use; and whatever a source or the store throws, after the pages before it are written. An abort rejects with the signal's reason.
 */
export const runSync = async (request: SyncRequest): Promise<SyncProgress> => {
  const { store, sources, modelId, scopes, resume, signal, onProgress } =
    request;
  const groups = bySource(scopes).map((group) => {
    const client = sources(group.prefix);
    if (client === undefined) {
      throw new UnknownSourceError(group.prefix);
    }

    return { ...group, client };
  });
  const startGroup =
    resume === undefined
      ? 0
      : groups.findIndex((group) => group.prefix === resume.source);
  if (startGroup === -1) {
    throw new Error(
      "The checkpoint names a source that none of the scopes use; start the sync again.",
    );
  }

  const known = new Set(await storedElements(store, modelId, signal));
  const activities = new Set<string>();
  const transitions = new Set<string>();
  const gaps: Gap[] = [];
  let held: readonly SourceTransition[] = [];
  let pages = 0;

  const write = async (
    page: SyncPage,
    checkpoint: SyncCheckpoint | undefined,
  ): Promise<void> => {
    for (const activity of page.activities) {
      known.add(activity.id);
    }
    const last = checkpoint === undefined;
    const candidates = [...held, ...page.transitions];
    const ready = candidates.filter(
      (transition) =>
        last || (known.has(transition.source) && known.has(transition.target)),
    );
    held = candidates.filter((transition) => !ready.includes(transition));
    await store.v1.items.upsert(
      {
        modelId,
        items: {
          participants: page.participants,
          activities: page.activities,
          transitions: ready,
          overlay: page.overlay,
        },
      },
      { signal },
    );
    pages += 1;
    for (const activity of page.activities) {
      activities.add(activity.id);
    }
    for (const transition of ready) {
      transitions.add(transition.id);
    }
    gaps.push(...page.gaps);
    onProgress({
      pages,
      activities: activities.size,
      transitions: transitions.size,
      gaps: [...gaps],
      checkpoint,
    });
  };

  /** Writes each page an iterator yields, in order, each only after the one before is written. */
  const drain = async (
    pagesOf: Readonly<AsyncIterator<SyncPage>>,
    checkpointAfter: (page: SyncPage) => SyncCheckpoint | undefined,
  ): Promise<void> => {
    const next = await pagesOf.next();
    if (next.done === true) {
      return;
    }
    await write(next.value, checkpointAfter(next.value));
    await drain(pagesOf, checkpointAfter);
  };

  /** Reads the sources in order, each only after the one before has finished, since a source's failure must stop the ones after it. */
  const readFrom = async (index: number): Promise<void> => {
    const group = groups[index];
    if (group === undefined) {
      return;
    }
    const after = index === startGroup ? resume?.after : undefined;
    const following = groups[index + 1];
    const stream = await group.client.v1.sync.stream(
      after === undefined
        ? { scope: group.scopes }
        : { scope: group.scopes, after },
      { signal },
    );
    const iterator = stream[Symbol.asyncIterator]();
    try {
      await drain(iterator, (page) =>
        page.next !== undefined
          ? { modelId, scopes, source: group.prefix, after: page.next }
          : following === undefined
            ? undefined
            : { modelId, scopes, source: following.prefix },
      );
    } catch (error) {
      // Closing the stream stops the source reading pages nobody will write.
      await iterator.return();
      throw error;
    }
    await readFrom(index + 1);
  };
  await readFrom(startGroup);

  return {
    pages,
    activities: activities.size,
    transitions: transitions.size,
    gaps,
    checkpoint: undefined,
  };
};
