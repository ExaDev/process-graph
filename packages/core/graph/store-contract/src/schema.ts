import { modelSchema, overlaySchema } from "@exadev/process-graph-schema";
import { z } from "zod";

/**
 * The model's own record schemas, taken from `modelSchema` rather than restated, so what the store accepts is exactly a model or a slice of one and can never drift from it.
 */
const modelShape = modelSchema.unwrap().shape;

/** The model's `activity` element: the first variant of its element union. A type test pins the order, so reordering the union is a compile error. */
const [activityElementSchema] = modelShape.elements.unwrap().element.options;

/** The name a store files a model under. Any non-empty string; the store gives it no structure. */
export const modelIdSchema = z.string().min(1);

/**
 * A position in the store's history. Every change to any model takes the next revision from one store-wide sequence, so revisions only grow, a model's revision is the revision of its last change, and a model deleted and saved again never reuses an earlier one.
 */
export const revisionSchema = z.int().positive();

/**
 * An activity bound to the external record it stands for. `source` is required here, where the model leaves it optional: a bound item's identity is its source record, and the source-qualified identifier is its element id.
 */
export const boundActivitySchema = activityElementSchema
  .unwrap()
  .extend({ source: z.string().min(1) })
  .refine((activity) => activity.id === activity.source, {
    message: "a bound activity's id must equal its source",
    path: ["id"],
  })
  .readonly();

/** The relation kinds a store keeps beside a model, the same kinds a source reports. */
export const relationKinds = ["child-of", "assigned-to", "part-of"] as const;

/**
 * A structural link the model has no field for, kept beside it: `child-of` from a sub-task element to its parent element, `assigned-to` from an element to a person participant, `part-of` from one participant to the participant that contains it (a repository to its organisation). A relation is identified by its kind and its two ends. Relations carry no ordering, so the structural queries never treat a parent as waiting on its children.
 */
export const relationSchema = z
  .strictObject({
    kind: z.enum(relationKinds),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .readonly();

/**
 * Items read from a source, to be merged into a stored model by identifier. Each participant, activity and transition replaces the one with the same id or is appended after the existing ones; the overlay's entries replace the run state of the elements they name; each relation not already stored is appended. Everything else in the model is left as it is.
 */
export const boundItemsSchema = z
  .strictObject({
    participants: z.array(modelShape.participants.unwrap().element).readonly(),
    activities: z.array(boundActivitySchema).readonly(),
    transitions: z.array(modelShape.transitions.unwrap().element).readonly(),
    overlay: overlaySchema,
    relations: z.array(relationSchema).readonly().exactOptional(),
  })
  .readonly();

/** One stored model and the run state laid over it, at the revision of its last change. */
export const storedModelSchema = z
  .strictObject({
    modelId: modelIdSchema,
    revision: revisionSchema,
    model: modelSchema,
    overlay: overlaySchema,
  })
  .readonly();

/** A stored model's name and the revision of its last change. */
export const modelSummarySchema = z
  .strictObject({ modelId: modelIdSchema, revision: revisionSchema })
  .readonly();

/** An element reached by a traversal and its distance from the start, in transitions. */
export const reachSchema = z
  .strictObject({ element: z.string(), distance: z.int().positive() })
  .readonly();

/** The kinds of change a store reports. */
export const changeKinds = ["saved", "overlay", "items", "deleted"] as const;

/**
 * A change to a model. `revision` is the revision the change took. `missed` says the subscriber missed one or more changes and should load the model again: it is sent at the start of a subscription that names a revision the model is no longer at (the model changed, or has gone), and in place of the changes a subscriber that reads too slowly has let pile up beyond its subscription's capacity.
 */
export const storeChangeSchema = z.union([
  z
    .strictObject({
      modelId: modelIdSchema,
      kind: z.enum(changeKinds),
      revision: revisionSchema,
    })
    .readonly(),
  z
    .strictObject({ modelId: modelIdSchema, kind: z.literal("missed") })
    .readonly(),
]);

/** A structural issue in a model or overlay, as `validate` and `validateOverlay` report it. */
export const issueSchema = z
  .strictObject({ code: z.string(), message: z.string() })
  .readonly();

export type ModelId = z.infer<typeof modelIdSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type BoundActivity = z.infer<typeof boundActivitySchema>;
export type BoundItems = z.infer<typeof boundItemsSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type RelationKind = (typeof relationKinds)[number];
export type StoredModel = z.infer<typeof storedModelSchema>;
export type ModelSummary = z.infer<typeof modelSummarySchema>;
export type Reach = z.infer<typeof reachSchema>;
export type ChangeKind = (typeof changeKinds)[number];
export type StoreChange = z.infer<typeof storeChangeSchema>;
