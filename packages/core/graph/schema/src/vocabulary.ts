/** What a participant is: a `role` or `system` can act, an `entity` has a lifecycle a state machine can track. */
export const participantKinds = ["role", "system", "entity"] as const;
export type ParticipantKind = (typeof participantKinds)[number];

export const pseudoRoles = [
  "initial",
  "final",
  "fork",
  "join",
  "history",
] as const;
export type PseudoRole = (typeof pseudoRoles)[number];

export const messageModes = [
  "sync",
  "async",
  "reply",
  "create",
  "destroy",
] as const;
export type MessageMode = (typeof messageModes)[number];

export const fragmentOperators = [
  "alt",
  "opt",
  "loop",
  "par",
  "break",
] as const;
export type FragmentOperator = (typeof fragmentOperators)[number];

/** Where an element stands in a run: finished, still to do, or not known. Run state is supplied by sources and never stored in the model. */
export const overlayStatuses = ["done", "open", "unknown"] as const;
export type OverlayStatus = (typeof overlayStatuses)[number];

export const notations = [
  "flowchart",
  "swimlane",
  "stateMachine",
  "sequence",
] as const;
export type Notation = (typeof notations)[number];
