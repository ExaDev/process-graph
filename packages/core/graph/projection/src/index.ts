/**
 * Projections of the process model into each notation: hand-offs, flowchart, swimlane, state machine and sequence diagram. Each is a pure function of the model plus the extra input its notation needs (none, a subject entity, or a scenario of transition ids).
 */
export type { Loss } from "./loss.ts";
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
  type SequenceMessage,
} from "./sequence.ts";
