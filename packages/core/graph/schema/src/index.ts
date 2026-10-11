/**
 * Shared process model for flowcharts, swimlanes, state machines and sequence diagrams.
 *
 * References are typed by identifier space. Each kind of thing that can be referenced (participant, event, action, element, transition, fragment) has its own string-literal union, inferred from the declarations. A reference to an identifier that was never declared is a compile error, and an identifier of one kind cannot stand in for another.
 *
 * Participants are split further by their declared kind. An `actor` (who performs a step, or sends or receives a message) must be a role or a system. A state machine `subject` must be an entity. Naming a participant of the wrong kind is a compile error too.
 */
export type { IdSpace, OpenIds } from "./ids.ts";
export {
  elementKinds,
  fragmentOperators,
  messageModes,
  notations,
  overlayStatuses,
  participantKinds,
  pseudoRoles,
  type ElementKind,
  type FragmentOperator,
  type MessageMode,
  type Notation,
  type ParticipantKind,
  type PseudoRole,
} from "./vocabulary.ts";
export type {
  ActionDef,
  ArtefactDef,
  Element,
  EventDef,
  Extensions,
  Fragment,
  FragmentOperand,
  Participant,
  Point,
  Projection,
  Transition,
  Views,
} from "./declarations.ts";
export { inputsOf, outputsOf } from "./artefacts.ts";
export { defineModel, type Model, type ModelParts } from "./model.ts";
export { validate, type Issue, type IssueCode } from "./validate.ts";
export {
  OverlayParseError,
  overlaySchema,
  parseOverlay,
  validateOverlay,
  type Overlay,
  type OverlayIssue,
} from "./overlay.ts";
export type { OverlayStatus } from "./vocabulary.ts";
export { modelSchema, type ModelSchema } from "./schema.ts";
export { ModelParseError, parseModel, type ModelIssue } from "./parse.ts";
