# @exadev/process-graph-layout

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@exadev/process-graph-layout) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

Layered layout of a projected view from `@exadev/process-graph-projection`. `layout(view, options)` is a pure async function: it reads a flowchart, swimlane or state machine, never mutates anything, and returns positions in the model's `views` shape, so layout stays apart from the semantic model and no projection reads a coordinate. It runs unchanged in a browser, a Worker or Node: `src/` imports nothing Node-only, and the default engine is elkjs's bundled build, which needs no Worker.

```ts
import { toSwimlane } from "@exadev/process-graph-projection";
import { layout } from "@exadev/process-graph-layout";

const { views, sizes, lanes } = await layout(toSwimlane(model), {
  direction: "down",
  signal: controller.signal,
});

const next = { ...model, views: { ...model.views, ...views } };
```

## API

| Export                     | Kind     | What it is                                                                                                          |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `layout`                   | function | `layout(view, options?)` resolves to a `LayoutResult`; rejects with the signal's reason when it aborts.             |
| `LayoutView`               | type     | The views that can be placed: `Flowchart`, `Swimlane` and `StateMachine`. A sequence diagram has no graph to place. |
| `LayoutOptions`            | type     | `direction`, `spacing`, `signal` and `engine`, all optional.                                                        |
| `LayoutResult`             | type     | `views`, `sizes` and `lanes`.                                                                                       |
| `LaneBounds`               | type     | A lane's participant and its `x`, `y`, `width` and `height`.                                                        |
| `LayoutEngine`             | type     | The injected port: `arrange(graph, signal)` resolves to one box per node.                                           |
| `createElkEngine`          | function | The default engine, elkjs's layered algorithm in the calling context.                                               |
| `EngineGraph` and siblings | types    | The engine-neutral request: nodes (leaves and groups), edges, direction and gaps.                                   |

### Result

- `views` is `{ [notation]: { [elementId]: { x, y } } }`, exactly the model's `Views` shape, with the key `flowchart`, `swimlane` or `stateMachine` after the view laid out. A position is the top-left corner of the element's box. Assign it to the model's `views` to store it.
- `sizes` is each element's extent, which a position alone does not give. Sizes come from the element's shape and are constants of this package.
- `lanes` holds one entry per swimlane lane, in the view's lane order, and is empty for the other views. Every node of a lane lies inside that lane's bounds, and lanes do not overlap.

### Options

- `direction` is `"right"` (default), `"down"`, `"left"` or `"up"`: the way edges generally point. A fork or join bar is drawn across the flow, so its size follows the direction.
- `spacing.node` is the gap between nodes in one layer and `spacing.layer` the gap between layers. They default to constants derived from one grid unit, so shapes of different kinds align.
- `signal` aborts the layout: the promise rejects with `signal.reason`, whether the signal was already aborted or aborts while the engine works.
- `engine` replaces the default engine.

## Swimlanes

Each lane is a group that contains its nodes, and the layered algorithm lays the groups out together with their contents, so a hand-off between lanes takes part in layer assignment. Nodes with no actor sit outside every lane. A lane with no nodes keeps a minimum extent so it stays visible. Lanes are placed as the algorithm arranges them, not as parallel bands.

## Determinism

The same view and options give the same positions with the default engine: elkjs's randomised choices are seeded with a fixed value, and the request lists nodes in the view's own order.

## Injecting an engine

`LayoutEngine` is the only place elkjs appears. A test, or an environment that wants layout off the calling thread, supplies its own: `arrange` receives an `EngineGraph` and returns an absolute-coordinate `EngineBox` for every node, groups included. `layout` stops waiting when the signal aborts and passes the signal to the engine so it can stop too.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests
pnpm test:smoke     # the built dist/ exercised as a real artefact
pnpm test:mutation  # Stryker
```
