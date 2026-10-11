# @exadev/process-graph-react-flow

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

[React Flow](https://reactflow.dev) views of the process model: a flowchart, a swimlane with each lane a group node, and a state machine, laid out by `@exadev/process-graph-layout`, drawn with `@exadev/process-graph-ui`'s styled cards, and reasoned over with `@exadev/process-graph-react`'s hooks. Each element shows its status (ready, blocked, done, skipped or unknown) and what blocks it, and the critical path is highlighted on its cards and its steps. A sequence projection is drawn by graph-ui's SVG `SequenceDiagram`, since React Flow has no lifeline layout. A private workspace package, published as part of `process-graph`. `src/` imports nothing Node-only.

```tsx
import "@exadev/process-graph-ui/style.css";
import "@exadev/process-graph-react-flow/style.css";
import { GraphTheme } from "@exadev/process-graph-ui";
import { ProcessView } from "@exadev/process-graph-react-flow";
import { noFacts } from "@exadev/process-graph-react";

const run = { model, overlay, facts: noFacts };
const lanes = { id: "lanes", notation: "swimlane" } as const;

<GraphTheme theme="light">
  <div style={{ height: "40rem" }}>
    <ProcessView
      run={run}
      projection={lanes}
      label="Release plan"
      onSelect={setSelected}
    />
  </div>
</GraphTheme>;
```

## Components

| Export        | What it is                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ProcessView` | Any projection: a sequence projection as graph-ui's `SequenceDiagram`, every other as a `ProcessFlow`.                    |
| `ProcessFlow` | A flowchart, swimlane or state machine on a React Flow canvas.                                                            |
| `toFlow`      | The pure conversion of a projected, laid-out view and a run into React Flow nodes and edges.                              |
| `useLayout`   | Lays out a view with `layout`, aborting a layout that is no longer wanted.                                                |
| `nodeTypes`   | The node components: `element` (graph-ui's element card with its handles) and `lane` (graph-ui's lane filling its group). |
| `edgeTypes`   | The edge component: `transition`, a stepped line with an arrowhead and its label.                                         |

`ProcessFlow` takes the run (`{ model, overlay, facts }`), a flowchart, swimlane or state machine projection, and an accessible `label`. Optionally: `layout`, the options passed to `graph-layout` (direction, spacing and the engine); `filter`, an `ElementFilter` that hides the elements it leaves out and every edge with a hidden end; `colorMode`, React Flow's own; and `onSelect`, called with each element a click or key selects. Keep the run's parts, the projection and the layout options stable between renders: a change lays the view out again.

## Layout

Positions and sizes come from `layout(view, options)`. The engine is injectable, so a test, or an application that lays out off the main thread, passes its own `LayoutEngine` in `layout.engine`; it defaults to elkjs. Each element node gets the size the layout gave it and its handles up front, on the sides the layout direction implies, so React Flow routes edges without measuring the nodes first. In a swimlane each lane is a group node at its laid-out bounds, holding its participant's elements at positions relative to it; elements with no actor, such as the start and end, sit outside every lane. Nothing is drawn until the layout resolves, and a layout that fails throws to the nearest error boundary.

## What is drawn

- An element node is graph-ui's `ElementCard`: its label, its status as a badge and its colour on the card's leading edge, a critical path marker, and "Blocked by" with the open work at the end of its blocked chain. The card carries `data-element-id`, `data-kind`, `data-status` and `data-critical`.
- A transition edge carries `data-transitions` with the model transitions it stands for. In a swimlane a hand-off is drawn in the hand-off colour and carries `data-handoff`; an edge between consecutive elements of the critical path is drawn thicker in the critical colour and carries `data-critical`. A state machine transition is labelled `event [guard] / effect`.
- Selection: a click selects an element and a click on the canvas clears it; once the canvas has focus, the arrow keys, Home, End and Escape move the selection through the shown elements in model order and focus the selected node, as `useGraphSelection` does.

## Styles

React Flow's stylesheet is imported once, by the build, and bundled with this package's own rules into `dist/style.css`: import it beside graph-ui's stylesheet, and put the view inside a graph-ui theme. Every colour is read from graph-ui's theme contract, so a theme assigned to the contract restyles the canvas too. React Flow needs its container to have a size.

## Commands

```sh
pnpm build          # vite build (JavaScript and CSS) and tsc -b (declarations) -> dist/
pnpm test           # unit tests in happy-dom, laid out by a stub engine
pnpm test:smoke     # the built dist/ rendered as a real artefact
pnpm test:mutation  # Stryker
```
