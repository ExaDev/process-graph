/**
 * Shared process model for flowcharts, swimlanes, state machines and sequence diagrams.
 *
 * References are typed by identifier space. Each kind of thing that can be referenced (participant, event, action, element, transition, fragment) has its own string-literal union, inferred from the declarations. A reference to an identifier that was never declared is a compile error, and an identifier of one kind cannot stand in for another.
 *
 * Participants are split further by their declared kind. An `actor` (who performs a step, or sends or receives a message) must be a role or a system. A state machine `subject` must be an entity. Naming a participant of the wrong kind is a compile error too.
 */
export type { IdSpace, OpenIds } from "./ids.ts";
export type {
  FragmentOperator,
  MessageMode,
  Notation,
  ParticipantKind,
  PseudoRole,
} from "./vocabulary.ts";
export type {
  ActionDef,
  Element,
  EventDef,
  Fragment,
  FragmentOperand,
  Participant,
  Point,
  Projection,
  Transition,
  Views,
} from "./declarations.ts";
export { defineModel, type Model, type ModelParts } from "./model.ts";
export { validate, type Issue, type IssueCode } from "./validate.ts";
