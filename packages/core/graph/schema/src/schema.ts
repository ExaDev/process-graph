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

const elementSchema = z.discriminatedUnion("kind", [
  record({
    kind: z.literal("activity"),
    id,
    label: z.string(),
    actor: actorRef.exactOptional(),
    action: actionRef.exactOptional(),
    source: z.string().exactOptional(),
  }),
  record({
    kind: z.literal("decision"),
    id,
    label: z.string(),
    actor: actorRef.exactOptional(),
  }),
  record({
    kind: z.literal("state"),
    id,
    label: z.string(),
    parent: elementRef.exactOptional(),
    entry: actionRef.exactOptional(),
    exit: actionRef.exactOptional(),
  }),
  record({
    kind: z.literal("pseudo"),
    id,
    role: z.enum(pseudoRoles),
    parent: elementRef.exactOptional(),
  }),
  record({
    kind: z.literal("message"),
    id,
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

/**
 * The open (runtime) shape of a model: identifiers are plain strings, so references are not checked here. `validate` checks what the shape cannot, and `parseModel` runs both.
 *
 * Every object is strict. The inferred type is exactly `Model<OpenIds>`, which a type-level test pins in both directions.
 */
export const modelSchema = record({
  participants: z.array(participantSchema).readonly(),
  events: z.array(eventSchema).readonly(),
  actions: z.array(actionSchema).readonly(),
  elements: z.array(elementSchema).readonly(),
  transitions: z.array(transitionSchema).readonly(),
  fragments: z.array(fragmentSchema).readonly(),
  projections: z.array(projectionSchema).readonly(),
  views: viewsSchema.exactOptional(),
});
