/**
 * The process-graph command line as a library. `runCli` runs the whole command surface against injected ports and resolves with the exit status, so a host program (Switchboard's `sb graph`) mounts it as a subcommand; the operations behind each command (`ready`, `blocked`, `why` and the rest) return plain data for hosts that want results rather than text, such as tools served over MCP; and the Mermaid and DOT emitters draw any projected view. `nodePorts` wires the ports for a Node process: the SQLite store, the GitHub issues source with a token from the environment, and the process's streams.
 */
export { runCli, defaultModelId, type ProgramIdentity } from "./program.ts";
export { exitCodes, type ExitCode } from "./exit-codes.ts";
export { CliError, failureOf, type Failure } from "./errors.ts";
export type { CliPorts, OpenedStore } from "./ports.ts";
export {
  defaultDataPath,
  nodePorts,
  packageVersion,
  runProcess,
  type NodePortsOptions,
} from "./node.ts";
export {
  findRun,
  loadRun,
  runFacts,
  type ElementSummary,
  type GraphSession,
  type StoredRun,
} from "./session.ts";
export {
  blocked,
  cycles,
  handoffsOf,
  impactOf,
  path,
  ready,
  why,
  type BlockedResult,
  type CyclesResult,
  type ElementStatus,
  type HandoffsResult,
  type ImpactResult,
  type PathResult,
  type ReadyResult,
  type WhyLink,
  type WhyResult,
} from "./queries.ts";
export {
  emit,
  formatNames,
  project,
  show,
  viewNames,
  type FormatName,
  type ProjectedView,
  type ShowRequest,
  type ShowResult,
  type ViewName,
} from "./show.ts";
export {
  add,
  artefactStates,
  factsOf,
  setArtefact,
  setFact,
  setState,
  type Addition,
  type ArtefactState,
  type FactsResult,
  type SetArtefactResult,
  type SetFactResult,
  type SetResult,
  type Written,
} from "./edit.ts";
export {
  validateDocument,
  validateStored,
  type ValidateResult,
  type ValidationIssue,
} from "./validate.ts";
export {
  sync,
  type SourceLookup,
  type SyncRequest,
  type SyncResult,
} from "./sync.ts";
export {
  flowchartToMermaid,
  sequenceToMermaid,
  stateMachineToMermaid,
  swimlaneToMermaid,
} from "./emit/mermaid.ts";
export {
  flowchartToDot,
  sequenceToDot,
  stateMachineToDot,
  swimlaneToDot,
} from "./emit/dot.ts";
