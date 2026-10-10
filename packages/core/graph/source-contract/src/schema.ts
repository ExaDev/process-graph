import { modelSchema, overlaySchema } from "@exadev/process-graph-schema";
import { z } from "zod";

/**
 * The model's own record schemas, taken from `modelSchema` rather than restated, so a page of a sync is exactly a slice of a model and can never drift from it.
 */
const modelShape = modelSchema.unwrap().shape;

/** A participant as the model declares it: an organisation, a repository, a person. */
export const participantSchema = modelShape.participants.unwrap().element;

/** A transition as the model declares it. A source emits one per dependency, from the prerequisite to the work that waits on it. */
export const transitionSchema = modelShape.transitions.unwrap().element;

/** The model's `activity` element: the first variant of its element union, pinned by a type test so a reordering of the union is a compile error. */
const [activityElementSchema] = modelShape.elements.unwrap().element.options;

/**
 * An activity bound to the external record it stands for. `source` is required here, where the model leaves it optional, and it equals `id`: the source-qualified identifier (`github:org/repo#12`) is the element's identity, so the same record synced twice, or reached from two places, is the same element.
 */
export const boundActivitySchema = activityElementSchema
  .unwrap()
  .extend({ source: z.string().min(1) })
  .refine((activity) => activity.id === activity.source, {
    message: "a bound activity's id must equal its source",
    path: ["id"],
  })
  .readonly();

/** The relation kinds a source reports beside the model's transitions. */
export const relationKinds = ["child-of", "assigned-to", "part-of"] as const;

/**
 * A structural link between two identifiers that the model has no field for: `child-of` from a sub-task activity to its parent activity, `assigned-to` from an activity to a person participant, `part-of` from one participant to the participant that contains it (a repository to its organisation). Relations carry no ordering, so a consumer decides whether a parent waits on its children.
 */
export const relationSchema = z
  .strictObject({
    kind: z.enum(relationKinds),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .readonly();

/** Why part of a requested scope is missing from a sync. */
export const gapReasons = ["not-found", "forbidden"] as const;

/**
 * A part of the requested scope that the source could not read, reported as data so the rest of the sync still arrives. `target` is the source-qualified identifier of what is missing: a scope, a record, or one of a record's connections.
 */
export const gapSchema = z
  .strictObject({
    target: z.string().min(1),
    reason: z.enum(gapReasons),
    message: z.string(),
  })
  .readonly();

/**
 * One page of a sync: bound activities, the participants they name, the transitions between them, their relations, their run state, and any gaps. A page is a partial view; `assembleSync` merges a whole sync into one model.
 *
 * `next` is the cursor to resume after this page. It is absent on the last page.
 */
export const syncPageSchema = z
  .strictObject({
    participants: z.array(participantSchema).readonly(),
    activities: z.array(boundActivitySchema).readonly(),
    transitions: z.array(transitionSchema).readonly(),
    relations: z.array(relationSchema).readonly(),
    overlay: overlaySchema,
    gaps: z.array(gapSchema).readonly(),
    next: z.string().min(1).exactOptional(),
  })
  .readonly();

/**
 * What to sync and where to resume. `scope` names what to read as source-qualified scope identifiers (for GitHub, `github:org` for every repository an owner has, or `github:org/repo`), read in the order given. `after` is a cursor from an earlier page's `next`: the sync continues with the page that followed it.
 */
export const syncInputSchema = z
  .strictObject({
    scope: z.array(z.string().min(1)).min(1).readonly(),
    after: z.string().min(1).exactOptional(),
  })
  .readonly();

/** What a source says about itself. `source` is the prefix of every identifier it emits, before the colon. */
export const sourceDescriptionSchema = z
  .strictObject({ source: z.string().regex(/^[a-z][a-z0-9-]*$/u) })
  .readonly();

/** Why a request was rejected as malformed. */
export const badRequestReasons = ["invalid-cursor", "invalid-scope"] as const;

export type BoundActivity = z.infer<typeof boundActivitySchema>;
export type SourceParticipant = z.infer<typeof participantSchema>;
export type SourceTransition = z.infer<typeof transitionSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type RelationKind = (typeof relationKinds)[number];
export type Gap = z.infer<typeof gapSchema>;
export type GapReason = (typeof gapReasons)[number];
export type SyncPage = z.output<typeof syncPageSchema>;
/** A page as an implementation supplies it, before parsing. */
export type SyncPageInput = z.input<typeof syncPageSchema>;
export type SyncInput = z.infer<typeof syncInputSchema>;
export type SourceDescription = z.infer<typeof sourceDescriptionSchema>;
export type BadRequestReason = (typeof badRequestReasons)[number];
