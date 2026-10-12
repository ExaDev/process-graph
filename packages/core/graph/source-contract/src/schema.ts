import {
  boundActivitySchema,
  modelSchema,
  overlaySchema,
} from "@exadev/process-graph-schema";
import { z } from "zod";

/**
 * The model's own record schemas, taken from `modelSchema` rather than restated, so a page of a sync is exactly a slice of a model and can never drift from it.
 */
const modelShape = modelSchema.unwrap().shape;

/** A participant as the model declares it: an organisation, a repository, a person. */
export const participantSchema = modelShape.participants.unwrap().element;

/** A transition as the model declares it. A source emits one per dependency, from the prerequisite to the work that waits on it. */
export const transitionSchema = modelShape.transitions.unwrap().element;

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
 * One page of a sync: bound activities (graph-schema's `boundActivitySchema`), the participants they name, the transitions between them, their relations, their run state, and any gaps. A page is a partial view; `assembleSync` merges a whole sync into one model.
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

/** The run states a sync filter can select by: whether the work is still open or done. */
export const filterStates = ["open", "done"] as const;

/** What a sync filter can order the listed records by: when they were created, when they last changed, or how much discussion they have. */
export const orderFields = ["created", "updated", "comments"] as const;

/** Which way a sync filter orders the listed records. */
export const orderDirections = ["ascending", "descending"] as const;

/**
 * Narrows and orders the records each scope lists, applied on the source's side where the source supports it. Every field is optional, and an absent field does not narrow.
 *
 * - `states` keeps records whose run state is one of those given.
 * - `labels` keeps records carrying at least one of the labels given.
 * - `order` is the order the records are listed in; absent, the source's own stable order.
 *
 * A filter narrows what a scope lists, not what the listed records reach: a blocker of a listed record is read whatever its own state or labels, because it is a dependency of work the filter kept.
 */
export const syncFilterSchema = z
  .strictObject({
    states: z.array(z.enum(filterStates)).min(1).readonly().exactOptional(),
    labels: z.array(z.string().min(1)).min(1).readonly().exactOptional(),
    order: z
      .strictObject({
        field: z.enum(orderFields),
        direction: z.enum(orderDirections),
      })
      .readonly()
      .exactOptional(),
  })
  .readonly();

/**
 * What to sync and where to resume. `scope` names what to read as source-qualified scope identifiers (for GitHub, `github:org` for every repository an owner has, or `github:org/repo`), read in the order given. `after` is a cursor from an earlier page's `next`: the sync continues with the page that followed it. A cursor is valid only with the scope list and the filter it was issued for.
 *
 * `filter` narrows and orders what each scope lists (see `syncFilterSchema`).
 */
export const syncInputSchema = z
  .strictObject({
    scope: z.array(z.string().min(1)).min(1).readonly(),
    after: z.string().min(1).exactOptional(),
    filter: syncFilterSchema.exactOptional(),
  })
  .readonly();

/**
 * A scope a person can choose to sync, as a picker lists it. `scope` is the scope identifier to pass to `sync` (for GitHub, `github:org` for an organisation, `github:org/repo` for a repository), `label` its display name, `description` the source's own description when it has one, `url` where it lives in the source's own interface, and `archived` whether the source has archived it.
 */
export const scopeEntrySchema = z
  .strictObject({
    scope: z.string().min(1),
    label: z.string(),
    description: z.string().exactOptional(),
    url: z.url().exactOptional(),
    archived: z.boolean(),
  })
  .readonly();

/**
 * One page of a scope listing. `entries` are in the source's stable listing order, `gaps` name a parent the source could not read (it does not exist, or the credentials cannot see it), and `next` is the cursor to resume after this page, absent on the last.
 */
export const scopeListingSchema = z
  .strictObject({
    entries: z.array(scopeEntrySchema).readonly(),
    gaps: z.array(gapSchema).readonly(),
    next: z.string().min(1).exactOptional(),
  })
  .readonly();

/** Where a listing of the top-level scopes resumes: a cursor from an earlier page's `next`. */
export const scopeRootsInputSchema = z
  .strictObject({ after: z.string().min(1).exactOptional() })
  .readonly();

/** The scope whose child scopes to list (for GitHub, the repositories of `github:owner`), and where to resume. A cursor is valid only for the parent it was issued for. */
export const scopeChildrenInputSchema = z
  .strictObject({
    scope: z.string().min(1),
    after: z.string().min(1).exactOptional(),
  })
  .readonly();

/** What a source says about itself. `source` is the prefix of every identifier it emits, before the colon. */
export const sourceDescriptionSchema = z
  .strictObject({ source: z.string().regex(/^[a-z][a-z0-9-]*$/u) })
  .readonly();

/** Why a request was rejected as malformed. */
export const badRequestReasons = ["invalid-cursor", "invalid-scope"] as const;

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
export type SyncFilter = z.infer<typeof syncFilterSchema>;
export type FilterState = (typeof filterStates)[number];
export type OrderField = (typeof orderFields)[number];
export type OrderDirection = (typeof orderDirections)[number];
export type ScopeEntry = z.infer<typeof scopeEntrySchema>;
export type ScopeListing = z.output<typeof scopeListingSchema>;
/** A listing page as an implementation supplies it, before parsing. */
export type ScopeListingInput = z.input<typeof scopeListingSchema>;
export type ScopeRootsInput = z.infer<typeof scopeRootsInputSchema>;
export type ScopeChildrenInput = z.infer<typeof scopeChildrenInputSchema>;
export type SourceDescription = z.infer<typeof sourceDescriptionSchema>;
export type BadRequestReason = (typeof badRequestReasons)[number];
