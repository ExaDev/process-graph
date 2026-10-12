import { JsonValueSchema, PredicateNodeSchema } from "trilean";
import { z } from "zod";
import {
  fragmentOperators,
  messageModes,
  notations,
  participantKinds,
  pseudoRoles,
} from "./vocabulary.ts";

/** An object schema that rejects unknown keys, so a misspelt field in a loaded document is an error and not silently dropped. */
const record = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.strictObject(shape).readonly();

const id = z.string();
const elementRef = z.string();
const actorRef = z.string();
const eventRef = z.string();
const actionRef = z.string();
const transitionRef = z.string();
const entityRef = z.string();
const artefactRef = z.string();

const extensionsSchema = z.record(z.string(), JsonValueSchema).readonly();

const participantSchema = record({
  id,
  label: z.string(),
  kind: z.enum(participantKinds),
});

const eventSchema = record({
  id,
  name: z.string(),
  payload: z.record(z.string(), z.string()).readonly().exactOptional(),
});

const actionSchema = record({ id, name: z.string() });

const artefactSchema = record({
  id,
  name: z.string(),
  deliverable: z.boolean().exactOptional(),
});

/** The strict object schema of an `activity` element, before it is made read-only: the one definition both the model's activity and a bound activity are built from. */
const activityObjectSchema = z.strictObject({
  kind: z.literal("activity"),
  id,
  extensions: extensionsSchema.exactOptional(),
  label: z.string(),
  actor: actorRef.exactOptional(),
  action: actionRef.exactOptional(),
  source: z.string().exactOptional(),
  affects: z.array(entityRef).readonly().exactOptional(),
  consumes: z.array(artefactRef).readonly().exactOptional(),
  produces: z.array(artefactRef).readonly().exactOptional(),
});

const elementSchema = z.discriminatedUnion("kind", [
  activityObjectSchema.readonly(),
  record({
    kind: z.literal("decision"),
    id,
    extensions: extensionsSchema.exactOptional(),
    label: z.string(),
    actor: actorRef.exactOptional(),
  }),
  record({
    kind: z.literal("state"),
    id,
    extensions: extensionsSchema.exactOptional(),
    label: z.string(),
    parent: elementRef.exactOptional(),
    entry: actionRef.exactOptional(),
    exit: actionRef.exactOptional(),
  }),
  record({
    kind: z.literal("pseudo"),
    id,
    extensions: extensionsSchema.exactOptional(),
    role: z.enum(pseudoRoles),
    parent: elementRef.exactOptional(),
  }),
  record({
    kind: z.literal("message"),
    id,
    extensions: extensionsSchema.exactOptional(),
    label: z.string(),
    from: actorRef,
    to: actorRef,
    mode: z.enum(messageModes),
    event: eventRef.exactOptional(),
  }),
]);

const transitionSchema = record({
  id,
  source: elementRef,
  target: elementRef,
  trigger: eventRef.exactOptional(),
  guard: z.string().exactOptional(),
  condition: PredicateNodeSchema.exactOptional(),
  effect: actionRef.exactOptional(),
});

const fragmentOperandSchema = record({
  guard: z.string().exactOptional(),
  body: z.array(elementRef).readonly(),
});

const fragmentSchema = record({
  id,
  operator: z.enum(fragmentOperators),
  operands: z.array(fragmentOperandSchema).readonly(),
});

const projectionSchema = z.union([
  record({
    id: z.string(),
    notation: z.enum(["flowchart", "swimlane"]),
  }),
  record({
    id: z.string(),
    notation: z.literal("stateMachine"),
    subject: entityRef,
  }),
  record({
    id: z.string(),
    notation: z.literal("sequence"),
    scenario: z.array(transitionRef).readonly(),
  }),
]);

const pointSchema = record({ x: z.number(), y: z.number() });

const viewsSchema = z
  .partialRecord(
    z.enum(notations),
    z.partialRecord(z.string(), pointSchema).readonly(),
  )
  .readonly();

/** The strict object schema inside `modelSchema`, before it is made read-only. */
const modelObjectSchema = z.strictObject({
  participants: z.array(participantSchema).readonly(),
  events: z.array(eventSchema).readonly(),
  actions: z.array(actionSchema).readonly(),
  artefacts: z.array(artefactSchema).readonly(),
  elements: z.array(elementSchema).readonly(),
  transitions: z.array(transitionSchema).readonly(),
  fragments: z.array(fragmentSchema).readonly(),
  projections: z.array(projectionSchema).readonly(),
  views: viewsSchema.exactOptional(),
});

/**
 * The type of `modelSchema`, declared by name so that a declaration file that embeds the schema, such as a consumer's `z.object({ model: modelSchema })` under `declaration: true`, refers to `ModelSchema` rather than writing out the whole model schema with every record and trilean's JSON value inline, which can exceed the length the compiler will serialise (TS7056).
 */
export interface ModelSchema extends z.ZodReadonly<typeof modelObjectSchema> {
  /** The strict object schema inside, whose `shape` holds each record's own schema. */
  readonly unwrap: () => typeof modelObjectSchema;
}

/**
 * The open (runtime) shape of a model: identifiers are plain strings, so references are not checked here. `validate` checks what the shape cannot, and `parseModel` runs both.
 *
 * Every object is strict. The inferred type is exactly `Model<OpenIds>`, which a type-level test pins in both directions.
 */
export const modelSchema: ModelSchema = modelObjectSchema.readonly();

/** The strict object schema inside `boundActivitySchema`, before it is made read-only. */
const boundActivityObjectSchema = activityObjectSchema
  .extend({ source: z.string().min(1) })
  .refine((activity) => activity.id === activity.source, {
    message: "a bound activity's id must equal its source",
    path: ["id"],
  });

/**
 * The type of `boundActivitySchema`, declared by name for the same reason as `ModelSchema`: a consumer's declaration file that embeds the schema, such as a source page's or a store's item list, refers to `BoundActivitySchema` rather than writing out the activity with trilean's JSON value inline.
 */
export interface BoundActivitySchema extends z.ZodReadonly<
  typeof boundActivityObjectSchema
> {
  /** The strict object schema inside, whose `shape` holds each field's own schema. */
  readonly unwrap: () => typeof boundActivityObjectSchema;
}

/**
 * An activity bound to the external record it stands for: the model's `activity` element with `source` required, where the model leaves it optional, and equal to `id`. The source-qualified identifier (`github:org/repo#12`) is the element's identity, so the same record synced twice, or reached from two places, is the same element.
 *
 * This is the one definition of a bound activity: a source's sync page and a store's upserted items both use it, so what a source emits is exactly what a store accepts.
 */
export const boundActivitySchema: BoundActivitySchema =
  boundActivityObjectSchema.readonly();

/** An activity bound to the external record it stands for, as `boundActivitySchema` parses it. */
export type BoundActivity = z.output<BoundActivitySchema>;
