/** A box with a fixed size, which the engine places. */
export interface EngineLeaf {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly children?: never;
}

/**
 * A box that encloses other nodes. The engine sizes it to fit its children, and never makes it smaller than `width` by `height`, so an empty group keeps a usable extent.
 */
export interface EngineGroup {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly children: readonly EngineNode[];
}

export type EngineNode = EngineLeaf | EngineGroup;

/** A directed edge between two leaves, which may sit in different groups. */
export interface EngineEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

/** The direction in which edges generally point. */
export type Direction = "right" | "down" | "left" | "up";

/** A layered layout request, free of any engine's own vocabulary. */
export interface EngineGraph {
  readonly direction: Direction;
  /** The gap between two nodes in the same layer. */
  readonly nodeGap: number;
  /** The gap between two consecutive layers. */
  readonly layerGap: number;
  /** The space between a group's border and its children. */
  readonly groupPadding: number;
  readonly nodes: readonly EngineNode[];
  readonly edges: readonly EngineEdge[];
}

/** One placed node, with its top-left corner in the coordinate space of the whole graph. */
export interface EngineBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The layout engine behind `layout`. An implementation must place every node of the graph, groups included, and return the same boxes for the same graph. It may run in the calling context or across a transport such as a Worker; `layout` stops waiting for it when the signal aborts, and an implementation should stop work as well.
 */
export interface LayoutEngine {
  readonly arrange: (
    graph: EngineGraph,
    signal: AbortSignal | undefined,
  ) => Promise<readonly EngineBox[]>;
}
