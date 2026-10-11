/**
 * Reasoning over the process model and a run overlay: the control graph, illegal cycles, three-valued status, decision evaluation and the queries built on them. Pure functions over `Model<I>` and an `Overlay<I>`; run state never enters the model.
 */
export { statuses, type Branch, type Status } from "./status.ts";
export {
  artefactKey,
  elementStatusKey,
  emptyFactRecord,
  evaluateBranches,
  factNamesIn,
  factsFrom,
  layeredFacts,
  UnsupportedConditionError,
  type FactRecord,
  type Facts,
} from "./facts.ts";
export { controlDag, illegalCycles, loopTransitions } from "./control.ts";
export {
  deriveStatuses,
  statusRules,
  type ArtefactBasis,
  type IncomingBasis,
  type ProducerBasis,
  type StatusBasis,
  type StatusRule,
} from "./derive.ts";
export {
  explainStatus,
  type ChainLink,
  type StatusExplanation,
} from "./explain.ts";
export {
  blockedBy,
  criticalPath,
  impact,
  readySet,
  unmetOutputs,
  whatIfDone,
  type StatusChange,
  type UnmetOutput,
  type WhatIf,
} from "./queries.ts";
