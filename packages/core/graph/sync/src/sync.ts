import type {
  Gap,
  GraphSourceClient,
  Relation,
  SourceTransition,
  SyncFilter,
  SyncPage,
} from "@exadev/process-graph-source-contract";
import type { GraphStoreClient } from "@exadev/process-graph-store-contract";
import { ORPCError } from "@orpc/client";
import type { SyncCheckpoint } from "./checkpoint.ts";
import { scopesBySource } from "./scopes.ts";

/** Finds the source that reads scopes with an identifier prefix, such as `github`, or nothing when no source does. */
export type SourceLookup = (prefix: string) => GraphSourceClient | undefined;

/** The part of the `GraphStore` client a sync calls: loading the model it merges into and upserting each page. */
export interface SyncStore {
  readonly v1: {
    readonly models: Pick<GraphStoreClient["v1"]["models"], "load">;
    readonly items: Pick<GraphStoreClient["v1"]["items"], "upsert">;
  };
}

/** How far a sync has got. Each count is of distinct identifiers (relations by kind and both ends) written by this sync. */
export interface SyncProgress {
  /** Pages read and written. */
  readonly pages: number;
  /** The revision the last write took. */
  readonly revision: number;
  readonly participants: number;
  /** Bound activities. */
  readonly activities: number;
  readonly transitions: number;
  /** Relations: sub-issues to their parents, assignees, repositories to their owners. */
  readonly relations: number;
  /** The parts of the scope the sources could not read, in the order met. */
  readonly gaps: readonly Gap[];
  /** Where to resume; absent once every scope has been read. */
  readonly checkpoint: SyncCheckpoint | undefined;
}

/** What to sync and where to. */
export interface SyncRequest {
  readonly store: SyncStore;
  readonly sources: SourceLookup;
  readonly modelId: string;
  /** Source-qualified scopes, read in order, one source after another. */
  readonly scopes: readonly string[];
  /** Narrows and orders what each scope lists. It is recorded in every checkpoint, since a cursor is valid only with the filter it was issued under. */
  readonly filter?: SyncFilter | undefined;
  /** A checkpoint from an interrupted sync of the same model, scopes and filter: the sync carries on from it. */
  readonly resume?: SyncCheckpoint | undefined;
  /** Ends the sync between or during reads; what was written stays written. */
  readonly signal?: AbortSignal | undefined;
  /** Called after every page is written, with the progress so far. */
  readonly onProgress?: ((progress: SyncProgress) => void) | undefined;
}

/** Thrown when a scope names a source no reader serves. */
export class UnknownSourceError extends Error {
  /** The source prefix no reader serves. */
  readonly prefix: string;

  /**
   * @param prefix - The source prefix no reader serves.
   */
  constructor(prefix: string) {
    super(`No source reads "${prefix}" scopes.`);
    this.name = "UnknownSourceError";
    this.prefix = prefix;
  }
}

/** The oRPC client options carrying a signal, leaving the key out when there is none, since the options type does not accept an explicit `undefined`. */
const callOptions = (
  signal: AbortSignal | undefined,
): { readonly signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

/** The identifiers of the elements and participants a model in the store already has, or none when the store has no such model. */
const storedIdentifiers = async (
  store: SyncStore,
  modelId: string,
  signal: AbortSignal | undefined,
): Promise<ReadonlySet<string>> => {
  try {
    const stored = await store.v1.models.load({ modelId }, callOptions(signal));

    return new Set([
      ...stored.model.elements.map((element) => element.id),
      ...stored.model.participants.map((participant) => participant.id),
    ]);
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") {
      return new Set();
    }
    throw error;
  }
};

const relationKey = (relation: Readonly<Relation>): string =>
  JSON.stringify([relation.kind, relation.from, relation.to]);

/** Splits what is waiting to be written into what can be written now, whose ends are all known, and what must wait for a later page. */
const settle = <T>(
  pending: readonly T[],
  endsOf: (item: T) => readonly string[],
  known: ReadonlySet<string>,
  last: boolean,
): { readonly ready: readonly T[]; readonly held: readonly T[] } => {
  const ready = pending.filter(
    (item) => last || endsOf(item).every((id) => known.has(id)),
  );

  return { ready, held: pending.filter((item) => !ready.includes(item)) };
};

/**
 * Reads the scopes from their sources page by page and merges each page into the stored model as soon as it is read: participants, bound activities, transitions, relations and run state. Progress is kept as it is made, so a sync that is cancelled, rate limited or interrupted leaves everything it read in the store, and a checkpoint to carry on from.
 *
 * A store rejects a write that leaves a transition or a relation naming an element or participant the model lacks, and a source may report a dependency or a sub-issue whose other end a later page brings. A transition or relation is therefore held back until the model has both of its ends, and written with the page that completes it. One whose end never arrives is written with the last page, where the store's rejection says which reference is missing.
 * @param request - The store, sources, model, scopes, an optional filter and checkpoint, the signal and a progress listener.
 * @returns The final progress, with no checkpoint.
 * @throws InvalidScopeError for a scope that names no source; UnknownSourceError for a scope whose source no reader serves; an Error for a checkpoint naming a source none of the scopes use, and for a sync of no scopes; and whatever a source or the store throws, after the pages before it are written. An abort rejects with the signal's reason.
 */
export const syncScopes = async (
  request: SyncRequest,
): Promise<SyncProgress> => {
  const { store, sources, modelId, scopes, filter, resume, signal } = request;
  const groups = scopesBySource(scopes).map((group) => {
    const client = sources(group.prefix);
    if (client === undefined) {
      throw new UnknownSourceError(group.prefix);
    }

    return { ...group, client };
  });
  if (groups.length === 0) {
    throw new Error("A sync needs at least one scope.");
  }
  const startGroup =
    resume === undefined
      ? 0
      : groups.findIndex((group) => group.prefix === resume.source);
  if (startGroup === -1) {
    throw new Error(
      "The checkpoint names a source that none of the scopes use; start the sync again.",
    );
  }

  const known = new Set(await storedIdentifiers(store, modelId, signal));
  const written = {
    participants: new Set<string>(),
    activities: new Set<string>(),
    transitions: new Set<string>(),
    relations: new Set<string>(),
  };
  const gaps: Gap[] = [];
  let heldTransitions: readonly SourceTransition[] = [];
  let heldRelations: readonly Relation[] = [];
  let pages = 0;
  let latest: SyncProgress | undefined;

  const checkpointAt = (
    source: string,
    after: string | undefined,
  ): SyncCheckpoint => ({
    modelId,
    scopes,
    ...(filter === undefined ? {} : { filter }),
    source,
    ...(after === undefined ? {} : { after }),
  });

  const write = async (
    page: SyncPage,
    checkpoint: SyncCheckpoint | undefined,
  ): Promise<void> => {
    for (const record of [...page.participants, ...page.activities]) {
      known.add(record.id);
    }
    const last = checkpoint === undefined;
    const transitions = settle(
      [...heldTransitions, ...page.transitions],
      (transition) => [transition.source, transition.target],
      known,
      last,
    );
    const relations = settle(
      [...heldRelations, ...page.relations],
      (relation) => [relation.from, relation.to],
      known,
      last,
    );
    heldTransitions = transitions.held;
    heldRelations = relations.held;
    const { revision } = await store.v1.items.upsert(
      {
        modelId,
        items: {
          participants: page.participants,
          activities: page.activities,
          transitions: transitions.ready,
          relations: relations.ready,
          overlay: page.overlay,
        },
      },
      callOptions(signal),
    );
    pages += 1;
    for (const participant of page.participants) {
      written.participants.add(participant.id);
    }
    for (const activity of page.activities) {
      written.activities.add(activity.id);
    }
    for (const transition of transitions.ready) {
      written.transitions.add(transition.id);
    }
    for (const relation of relations.ready) {
      written.relations.add(relationKey(relation));
    }
    gaps.push(...page.gaps);
    latest = {
      pages,
      revision,
      participants: written.participants.size,
      activities: written.activities.size,
      transitions: written.transitions.size,
      relations: written.relations.size,
      gaps: [...gaps],
      checkpoint,
    };
    request.onProgress?.(latest);
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
      {
        scope: group.scopes,
        ...(after === undefined ? {} : { after }),
        ...(filter === undefined ? {} : { filter }),
      },
      callOptions(signal),
    );
    const iterator = stream[Symbol.asyncIterator]();
    try {
      await drain(iterator, (page) =>
        page.next !== undefined
          ? checkpointAt(group.prefix, page.next)
          : following === undefined
            ? undefined
            : checkpointAt(following.prefix, undefined),
      );
    } catch (error) {
      // Closing the stream stops the source reading pages nobody will write.
      await iterator.return();
      throw error;
    }
    await readFrom(index + 1);
  };
  await readFrom(startGroup);

  if (latest === undefined) {
    throw new Error(
      "unreachable: every source answers a sync with at least one page",
    );
  }

  return latest;
};
