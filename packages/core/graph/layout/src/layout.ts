import type {
  Flowchart,
  FlowNode,
  StateMachine,
  StateMachineState,
  Swimlane,
} from "@exadev/process-graph-projection";
import type {
  IdSpace,
  Notation,
  Point,
  Views,
} from "@exadev/process-graph-schema";
import { createElkEngine } from "./elk-engine.ts";
import type {
  Direction,
  EngineBox,
  EngineEdge,
  EngineNode,
  LayoutEngine,
} from "./engine.ts";
import {
  barSize,
  DECISION_SIZE,
  DEFAULT_LAYER_GAP,
  DEFAULT_NODE_GAP,
  LANE_MINIMUM_SIZE,
  LANE_PADDING,
  PROCESS_SIZE,
  PSEUDO_STATE_SIZE,
  TERMINATOR_SIZE,
  type Size,
} from "./metrics.ts";

/**
 * A projection result that can be laid out. A sequence diagram is not here: its lifelines and messages have a fixed arrangement, not a graph to place.
 */
export type LayoutView<I extends IdSpace> =
  Flowchart<I> | Swimlane<I> | StateMachine<I>;

export interface LayoutOptions {
  /** The direction in which edges generally point. Defaults to `"right"`. */
  readonly direction?: Direction;
  /** Overrides for the gaps, in layout units. Each defaults to a grid-derived constant. */
  readonly spacing?: {
    /** The gap between two nodes in the same layer. */
    readonly node?: number;
    /** The gap between consecutive layers. */
    readonly layer?: number;
  };
  /** Rejects the returned promise with the signal's reason when it aborts. */
  readonly signal?: AbortSignal;
  /** The engine that places the nodes. Defaults to elkjs's layered algorithm run in the calling context. */
  readonly engine?: LayoutEngine;
}

/** The bounds of one swimlane, in the same coordinate space as the node positions. */
export interface LaneBounds<I extends IdSpace> {
  readonly participant: I["participant"] | I["actor"];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutResult<I extends IdSpace> {
  /** Top-left positions keyed by notation and element id: the model's `views` shape, ready to assign to `Model.views`. */
  readonly views: Views<I["element"]>;
  /** The extent of each placed element, which a position alone does not give. */
  readonly sizes: Readonly<Partial<Record<I["element"], Size>>>;
  /** One entry per swimlane lane, in the view's lane order; empty for a flowchart and a state machine. */
  readonly lanes: readonly LaneBounds<I>[];
}

const flowNodeSizes: Readonly<
  Record<Exclude<FlowNode<IdSpace>["shape"], "bar">, Size>
> = {
  process: PROCESS_SIZE,
  terminator: TERMINATOR_SIZE,
  decision: DECISION_SIZE,
};

const flowNodeSize = (
  shape: FlowNode<IdSpace>["shape"],
  direction: Direction,
): Size => (shape === "bar" ? barSize(direction) : flowNodeSizes[shape]);

const stateSize = (role: StateMachineState<IdSpace>["role"]): Size =>
  role === "state" ? PROCESS_SIZE : PSEUDO_STATE_SIZE;

interface Prepared<I extends IdSpace> {
  readonly notation: Extract<
    Notation,
    "flowchart" | "swimlane" | "stateMachine"
  >;
  readonly elements: readonly {
    readonly id: I["element"];
    readonly size: Size;
  }[];
  readonly edges: readonly {
    readonly from: I["element"];
    readonly to: I["element"];
  }[];
  readonly lanes: readonly {
    readonly participant: I["participant"] | I["actor"];
    readonly nodes: readonly I["element"][];
  }[];
}

const prepare = <I extends IdSpace>(
  view: LayoutView<I>,
  direction: Direction,
): Prepared<I> => {
  if ("states" in view) {
    return {
      notation: "stateMachine",
      elements: view.states.map((state) => ({
        id: state.id,
        size: stateSize(state.role),
      })),
      edges: view.transitions.map((transition) => ({
        from: transition.source,
        to: transition.target,
      })),
      lanes: [],
    };
  }
  const elements = view.nodes.map((node) => ({
    id: node.id,
    size: flowNodeSize(node.shape, direction),
  }));
  if ("lanes" in view) {
    return {
      notation: "swimlane",
      elements,
      edges: view.edges,
      lanes: view.lanes,
    };
  }

  return { notation: "flowchart", elements, edges: view.edges, lanes: [] };
};

/**
 * Settles by throwing the signal's own reason once it aborts, and never settles if `stop` aborts first, which also removes the listener.
 */
const whenAborted = async (
  signal: AbortSignal,
  stop: AbortSignal,
): Promise<never> => {
  await new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true, signal: stop },
    );
  });
  signal.throwIfAborted();
  throw new Error("The signal aborted without a reason");
};

/**
 * Places a projected view with a layered layout and returns where each element goes, as the model's `views` shape.
 *
 * Pure with respect to the model: it reads only the view, never mutates it, and the model stores the result apart from its semantics, so no projection reads a coordinate. The same view and options give the same positions with the default engine. Swimlane lanes are groups, and every node lies inside its lane's bounds.
 * @param view - A flowchart, swimlane or state machine from the projection package.
 * @param options - Direction, spacing, abort signal and engine.
 * @returns Positions keyed by notation and element id, element sizes and lane bounds.
 * @throws The signal's reason when `options.signal` aborts before the layout completes.
 */
export const layout = async <I extends IdSpace>(
  view: LayoutView<I>,
  options: LayoutOptions = {},
): Promise<LayoutResult<I>> => {
  const {
    direction = "right",
    spacing,
    signal,
    engine = createElkEngine(),
  } = options;
  signal?.throwIfAborted();

  const prepared = prepare(view, direction);

  const elementIds = new Map<I["element"], string>();
  const leaves = new Map<
    string,
    { readonly id: I["element"]; readonly size: Size }
  >();
  prepared.elements.forEach((element, index) => {
    const id = `n${index}`;
    elementIds.set(element.id, id);
    leaves.set(id, element);
  });

  const leafNode = (id: string, size: Size): EngineNode => ({ id, ...size });
  const nodeFor = (element: I["element"]): EngineNode | undefined => {
    const id = elementIds.get(element);
    const leaf = id === undefined ? undefined : leaves.get(id);

    return id === undefined || leaf === undefined
      ? undefined
      : leafNode(id, leaf.size);
  };

  const placedInLane = new Set<I["element"]>();
  const laneIds: string[] = [];
  const nodes: EngineNode[] = [];
  prepared.lanes.forEach((lane, index) => {
    const id = `l${index}`;
    laneIds.push(id);
    const children: EngineNode[] = [];
    for (const element of lane.nodes) {
      const child = nodeFor(element);
      if (child !== undefined) {
        placedInLane.add(element);
        children.push(child);
      }
    }
    nodes.push({ id, ...LANE_MINIMUM_SIZE, children });
  });
  for (const element of prepared.elements) {
    if (!placedInLane.has(element.id)) {
      const node = nodeFor(element.id);
      if (node !== undefined) {
        nodes.push(node);
      }
    }
  }

  const edges: EngineEdge[] = [];
  prepared.edges.forEach((edge, index) => {
    const source = elementIds.get(edge.from);
    const target = elementIds.get(edge.to);
    if (source !== undefined && target !== undefined) {
      edges.push({ id: `e${index}`, source, target });
    }
  });

  const request = engine.arrange(
    {
      direction,
      nodeGap: spacing?.node ?? DEFAULT_NODE_GAP,
      layerGap: spacing?.layer ?? DEFAULT_LAYER_GAP,
      groupPadding: LANE_PADDING,
      nodes,
      edges,
    },
    signal,
  );
  let boxes: readonly EngineBox[];
  if (signal === undefined) {
    boxes = await request;
  } else {
    const stop = new AbortController();
    try {
      boxes = await Promise.race([request, whenAborted(signal, stop.signal)]);
    } finally {
      stop.abort();
    }
  }

  const byId = new Map<string, EngineBox>(boxes.map((box) => [box.id, box]));
  const positions: Partial<Record<I["element"], Point>> = {};
  const sizes: Partial<Record<I["element"], Size>> = {};
  for (const [id, element] of leaves) {
    const box = byId.get(id);
    if (box === undefined) {
      throw new Error(
        `The layout engine returned no box for element "${element.id}"`,
      );
    }
    positions[element.id] = { x: box.x, y: box.y };
    sizes[element.id] = { width: box.width, height: box.height };
  }

  const lanes: LaneBounds<I>[] = prepared.lanes.map((lane, index) => {
    const box = byId.get(laneIds[index] ?? "");
    if (box === undefined) {
      throw new Error(
        `The layout engine returned no box for lane "${lane.participant}"`,
      );
    }

    return {
      participant: lane.participant,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });

  return { views: { [prepared.notation]: positions }, sizes, lanes };
};
