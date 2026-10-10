/**
 * Layered layout of a projected process view. `layout` places a flowchart, swimlane or state machine and returns positions in the model's `views` shape, so layout stays apart from the semantic model and no projection reads a coordinate.
 */
export { layout } from "./layout.ts";
export type {
  LaneBounds,
  LayoutOptions,
  LayoutResult,
  LayoutView,
} from "./layout.ts";
export { createElkEngine } from "./elk-engine.ts";
export type {
  Direction,
  EngineBox,
  EngineEdge,
  EngineGraph,
  EngineGroup,
  EngineLeaf,
  EngineNode,
  LayoutEngine,
} from "./engine.ts";
export type { Size } from "./metrics.ts";
