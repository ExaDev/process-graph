import type { Model, OpenIds, Overlay } from "@exadev/process-graph-schema";
import { GraphStoreError } from "./errors.ts";
import { ChangeFeed } from "./feed.ts";
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  mergeRelations,
  relationIssues,
  relationsWithin,
} from "./hierarchy.ts";
import {
  checkStored,
  emptyModel,
  mergeBoundItems,
  overlayWithin,
} from "./merge.ts";
import type { ChangeKind, Relation, StoredModel } from "./schema.ts";
import type { GraphStore } from "./store.ts";
import { blockedChainOf, impactOf, readyOf, structureOf } from "./structure.ts";

/** Runs a synchronous store operation as the async one the port expects; a throw becomes a rejection. */
const later =
  <A, R>(operation: (request: A) => R) =>
  async (request: A): Promise<R> =>
    Promise.resolve(request).then(operation);

/** One stored entry: everything `models.load` returns. */
interface Entry {
  readonly model: Model<OpenIds>;
  readonly overlay: Overlay<OpenIds>;
  readonly relations: readonly Relation[];
  readonly revision: number;
}

const encoder = new TextEncoder();

/**
 * Orders strings by their UTF-8 bytes, which is Unicode code point order and the order SQLite's default `BINARY` collation gives text. JavaScript's own `<` compares UTF-16 code units, which puts characters outside the Basic Multilingual Plane before those from U+E000 up.
 */
const byCodePoint = (left: string, right: string): number => {
  const theirs = encoder.encode(right).values();
  for (const byte of encoder.encode(left)) {
    const other = theirs.next();
    if (other.done === true) {
      return 1;
    }
    if (byte !== other.value) {
      return byte - other.value;
    }
  }

  return theirs.next().done === true ? 0 : -1;
};

/**
 * The reference in-memory store: the behaviour every adapter's conformance run is compared with. Models are held as values and replaced on every write, so a failed check leaves the previous value in place.
 * @returns A store with no models, revisions starting after zero.
 */
export const createFakeGraphStore = (): GraphStore => {
  const feed = new ChangeFeed();
  const entries = new Map<string, Entry>();
  let sequence = 0;

  const entryOf = (modelId: string): Entry => {
    const entry = entries.get(modelId);
    if (entry === undefined) {
      throw new GraphStoreError({ kind: "not-found", modelId });
    }

    return entry;
  };

  const elementOf = (modelId: string, element: string): Entry => {
    const entry = entryOf(modelId);
    if (!entry.model.elements.some(({ id }) => id === element)) {
      throw new GraphStoreError({ kind: "not-found", modelId, element });
    }

    return entry;
  };

  /** What one write stores and reports. */
  interface Write {
    readonly modelId: string;
    readonly kind: ChangeKind;
    readonly model: Model<OpenIds>;
    readonly overlay: Overlay<OpenIds>;
    readonly relations: readonly Relation[];
    readonly signal: AbortSignal | undefined;
  }

  const write = ({
    modelId,
    kind,
    model,
    overlay,
    relations,
    signal,
  }: Write): number => {
    checkStored(model, overlay);
    const issues = relationIssues(model, relations);
    if (issues.length > 0) {
      throw new GraphStoreError({ kind: "invalid", issues });
    }
    signal?.throwIfAborted();
    sequence += 1;
    entries.set(modelId, { model, overlay, relations, revision: sequence });
    feed.publish({ modelId, kind, revision: sequence });

    return sequence;
  };

  return {
    feed,
    listModels: later(() =>
      [...entries]
        .map(([modelId, { revision }]) => ({ modelId, revision }))
        .sort((left, right) => byCodePoint(left.modelId, right.modelId)),
    ),
    saveModel: later(({ modelId, model, signal }) => {
      const existing = entries.get(modelId);

      return write({
        modelId,
        kind: "saved",
        model,
        overlay: overlayWithin(model, existing?.overlay ?? {}),
        relations: relationsWithin(model, existing?.relations ?? []),
        signal,
      });
    }),
    loadModel: later(({ modelId }): StoredModel => {
      const { model, overlay, revision } = entryOf(modelId);

      return { modelId, revision, model, overlay };
    }),
    deleteModel: later(({ modelId, signal }) => {
      if (!entries.has(modelId)) {
        return undefined;
      }
      signal?.throwIfAborted();
      entries.delete(modelId);
      sequence += 1;
      feed.publish({ modelId, kind: "deleted", revision: sequence });

      return sequence;
    }),
    applyOverlay: later(({ modelId, overlay, signal }) => {
      const entry = entryOf(modelId);

      return write({
        modelId,
        kind: "overlay",
        model: entry.model,
        overlay: { ...entry.overlay, ...overlay },
        relations: entry.relations,
        signal,
      });
    }),
    upsertItems: later(({ modelId, items, signal }) => {
      const entry = entries.get(modelId) ?? {
        model: emptyModel,
        overlay: {},
        relations: [],
      };

      return write({
        modelId,
        kind: "items",
        ...mergeBoundItems(entry.model, entry.overlay, items),
        relations: mergeRelations(entry.relations, items.relations ?? []),
        signal,
      });
    }),
    relations: later(({ modelId }) => entryOf(modelId).relations),
    children: later(({ modelId, element }) => {
      const { model, relations } = elementOf(modelId, element);

      return childrenOf(model, relations, element);
    }),
    descendants: later(({ modelId, element }) => {
      const { model, relations } = elementOf(modelId, element);

      return descendantsOf(model, relations, element);
    }),
    ancestors: later(({ modelId, element }) => {
      const { model, relations } = elementOf(modelId, element);

      return ancestorsOf(model, relations, element);
    }),
    ready: later(({ modelId }) => {
      const { model, overlay } = entryOf(modelId);

      return readyOf(structureOf(model, overlay));
    }),
    blockedChain: later(({ modelId, element }) => {
      const { model, overlay } = elementOf(modelId, element);

      return blockedChainOf(structureOf(model, overlay), element);
    }),
    impact: later(({ modelId, element }) => {
      const { model, overlay } = elementOf(modelId, element);

      return impactOf(structureOf(model, overlay), element);
    }),
    revisionOf: later(({ modelId }) => entries.get(modelId)?.revision),
  };
};
