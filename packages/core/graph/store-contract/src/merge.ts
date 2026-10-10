import {
  validate,
  validateOverlay,
  type Model,
  type OpenIds,
  type Overlay,
} from "@exadev/process-graph-schema";
import { GraphStoreError } from "./errors.ts";
import type { BoundItems } from "./schema.ts";

/** A model with nothing in it, which `items.upsert` starts from when the model does not exist yet. */
export const emptyModel: Model<OpenIds> = {
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [],
  transitions: [],
  fragments: [],
  projections: [],
};

/** Replaces each record of `current` that an incoming record shares an id with, in place, and appends the rest in their incoming order. */
const upsertById = <T extends { readonly id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): readonly T[] => {
  const replacements = new Map(incoming.map((record) => [record.id, record]));
  const known = new Set(current.map(({ id }) => id));

  return [
    ...current.map((record) => replacements.get(record.id) ?? record),
    ...incoming.filter(({ id }) => !known.has(id)),
  ];
};

/**
 * Merges items read from a source into a model and its overlay: participants, activities and transitions by id, replacing a record in its place or appending a new one; overlay entries replace the run state of the elements they name. The result is not checked; see `checkStored`.
 * @param model - The stored model.
 * @param overlay - The stored overlay.
 * @param items - The items to merge.
 * @returns The merged model and overlay.
 */
export const mergeBoundItems = (
  model: Model<OpenIds>,
  overlay: Overlay<OpenIds>,
  items: BoundItems,
): { readonly model: Model<OpenIds>; readonly overlay: Overlay<OpenIds> } => ({
  model: {
    ...model,
    participants: upsertById(model.participants, items.participants),
    elements: upsertById(model.elements, items.activities),
    transitions: upsertById(model.transitions, items.transitions),
  },
  overlay: { ...overlay, ...items.overlay },
});

/**
 * Keeps only the overlay entries that name an element of the model, so replacing a model drops the run state of elements it no longer declares.
 * @param model - The model the overlay is for.
 * @param overlay - The overlay to narrow.
 * @returns The entries whose key is an element of `model`.
 */
export const overlayWithin = (
  model: Model<OpenIds>,
  overlay: Overlay<OpenIds>,
): Overlay<OpenIds> => {
  const elements = new Set(model.elements.map(({ id }) => id));

  return Object.fromEntries(
    Object.entries(overlay).filter(([id]) => elements.has(id)),
  );
};

/**
 * Checks a model and overlay a write is about to store. Every store runs this before committing, so a store never holds a model `validate` rejects or an overlay entry for an element the model does not declare.
 * @param model - The model to store.
 * @param overlay - The overlay to store with it.
 * @throws GraphStoreError with `invalid` and every issue found, when there is any.
 */
export const checkStored = (
  model: Model<OpenIds>,
  overlay: Overlay<OpenIds>,
): void => {
  const issues = [...validate(model), ...validateOverlay(model, overlay)];
  if (issues.length > 0) {
    throw new GraphStoreError({ kind: "invalid", issues });
  }
};
