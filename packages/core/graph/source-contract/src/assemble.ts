import type { Model, OpenIds, Overlay } from "@exadev/process-graph-schema";
import type { Gap, Relation, SyncPage } from "./schema.ts";

/** A whole sync merged into one model, with what the model has no place for kept beside it. */
export interface AssembledSync {
  /** The participants, bound activities and transitions of every page, each identifier once. */
  readonly model: Model<OpenIds>;
  /** The run state of every activity, keyed by its identifier. */
  readonly overlay: Overlay<OpenIds>;
  /** Every relation, each distinct one once. */
  readonly relations: readonly Relation[];
  /** Every gap, in page order. */
  readonly gaps: readonly Gap[];
}

const relationKey = (relation: Readonly<Relation>): string =>
  JSON.stringify([relation.kind, relation.from, relation.to]);

/** Keeps one entry per key, in first-seen order, holding the latest value seen for it. */
const latestById = <T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly T[] => {
  const byKey = new Map<string, T>();
  for (const item of items) {
    byKey.set(keyOf(item), item);
  }

  return [...byKey.values()];
};

/**
 * Merges the pages of a sync into one model. A record can appear on several pages, for example an issue in another repository reached through a dependency before its own repository is read; identity is the identifier, so it becomes one element, and where pages disagree the later page wins, being the more recent read.
 * @param pages - The pages of one sync, in the order they arrived.
 * @returns The model, overlay, relations and gaps of the whole sync.
 */
export const assembleSync = (pages: readonly SyncPage[]): AssembledSync => {
  // Entries later in the list overwrite earlier ones, so the later page wins.
  const overlay: Overlay<OpenIds> = Object.fromEntries(
    pages.flatMap((page) => Object.entries(page.overlay)),
  );

  return {
    model: {
      participants: latestById(
        pages.flatMap((page) => page.participants),
        (participant) => participant.id,
      ),
      events: [],
      actions: [],
      artefacts: [],
      elements: latestById(
        pages.flatMap((page) => page.activities),
        (activity) => activity.id,
      ),
      transitions: latestById(
        pages.flatMap((page) => page.transitions),
        (transition) => transition.id,
      ),
      fragments: [],
      projections: [],
    },
    overlay,
    relations: latestById(
      pages.flatMap((page) => page.relations),
      relationKey,
    ),
    gaps: pages.flatMap((page) => page.gaps),
  };
};
