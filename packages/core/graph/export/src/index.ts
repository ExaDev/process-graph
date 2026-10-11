/**
 * Text exports of a projected view: Mermaid and Graphviz DOT for the flowchart, swimlane, state machine and sequence diagram, and the projection itself as JSON. Every label from a source is made safe to show: escaped for the notation, and with every control and invisible format character written as a visible escape. The command line's `show` and the web app's downloads both write through `viewText`.
 */
export { exportFormats, viewText, type ExportFormat } from "./view.ts";
export {
  flowchartToMermaid,
  sequenceToMermaid,
  stateMachineToMermaid,
  swimlaneToMermaid,
} from "./mermaid.ts";
export {
  flowchartToDot,
  sequenceToDot,
  stateMachineToDot,
  swimlaneToDot,
} from "./dot.ts";
export {
  isUnsafeCharacter,
  terminalJson,
  terminalText,
} from "./terminal-text.ts";
