/**
 * Projections of the process model into each notation: hand-offs, flowchart, swimlane, state machine and sequence diagram. Each is a pure function of the model plus the extra input its notation needs (none, a subject entity, or a scenario of transition ids), and returns what it dropped. Each view also has an inverse that turns an edited view back into a typed diff against the model, applied with `applyModelDiff` once every inferred change is confirmed.
 */
export type { Loss, UnrepresentedElement, UnrepresentedKind } from "./loss.ts";
export { handoffs, type Handoff } from "./handoffs.ts";
export {
  toFlowchart,
  type Flowchart,
  type FlowEdge,
  type FlowNode,
} from "./flowchart.ts";
export { toSwimlane, type Lane, type Swimlane } from "./swimlane.ts";
export {
  toStateMachine,
  type StateMachine,
  type StateMachineState,
  type StateMachineTransition,
} from "./state-machine.ts";
export {
  toSequence,
  type SequenceDiagram,
  type SequenceItem,
  type SequenceMessage,
  type SequenceOperand,
} from "./sequence.ts";
export {
  applyModelDiff,
  confirmChanges,
  UnconfirmedChangeError,
  type Addressing,
  type Change,
  type ElementChange,
  type Ends,
  type EventChange,
  type ModelDiff,
  type TransitionChange,
  type TransitionFieldChange,
} from "./diff.ts";
export {
  project,
  type ProjectedView,
  type ViewsByNotation,
} from "./project.ts";
export { diffFlowchart, diffSwimlane } from "./inverse-flowchart.ts";
export { diffStateMachine } from "./inverse-state-machine.ts";
export { diffSequence } from "./inverse-sequence.ts";
