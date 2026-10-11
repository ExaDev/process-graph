# @exadev/process-graph-export

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as its exports at the root entry, `process-graph`.

Text exports of a view projected by [`graph-projection`](../projection/README.md): Mermaid and Graphviz DOT for the flowchart, swimlane, state machine and sequence diagram, and the projection itself as JSON. The command line's `show` and the web app's downloads both write through `viewText`, so the same view gives the same text in both. `src/` imports nothing Node-only.

```ts
import { project } from "@exadev/process-graph-projection";
import { viewText } from "@exadev/process-graph-export";

const projected = project(model, { id: "lanes", notation: "swimlane" });
viewText(model, projected, "mermaid"); // flowchart LR ... with a subgraph per lane
viewText(model, projected, "dot"); // digraph "swimlane" { ... } with a cluster per lane
viewText(model, projected, "json"); // the swimlane projection, indented
```

## Functions

| Export                                                                                  | What it is                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewText(model, projected, format)`                                                    | A `ProjectedView` as `mermaid`, `dot` or `json` text; the model gives a sequence diagram's participant labels, an undeclared actor shown by its identifier. |
| `exportFormats`, `ExportFormat`                                                         | The formats `viewText` writes.                                                                                                                              |
| `flowchartToMermaid`, `swimlaneToMermaid`, `stateMachineToMermaid`, `sequenceToMermaid` | Each notation as Mermaid source, ending with a line break.                                                                                                  |
| `flowchartToDot`, `swimlaneToDot`, `stateMachineToDot`, `sequenceToDot`                 | Each notation as Graphviz DOT source, ending with a line break.                                                                                             |
| `terminalText(text)`, `terminalJson(value)`, `isUnsafeCharacter(character)`             | Text and JSON made safe to show: every control, format, separator, unassigned and private-use character written as a visible escape of its code point.      |

## Safe labels

A label from a source (an issue title, a repository name) can carry characters that break a diagram or act on whatever shows it. The Mermaid emitters name nodes by their position in the view, since Mermaid does not accept identifiers such as `github:org/repo#12`, and write every character Mermaid reads as syntax as its entity code. The DOT emitters keep the model identifiers and quote every one. In both, every character in the Unicode general categories `Cc`, `Cf`, `Zl`, `Zp`, `Cn` and `Co` is written as a visible escape such as `\u{1b}`, apart from line feed, tab and the zero-width joiner and non-joiner, which text in many scripts needs. Hand-offs are thick (Mermaid) or bold (DOT) edges, and DOT, which has no sequence notation, draws a sequence diagram as a grid of lifelines with one numbered row per message.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
