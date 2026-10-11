import type { Status } from "@exadev/process-graph-domain";
import type {
  Direction,
  LaneBounds,
  LayoutResult,
  Size,
} from "@exadev/process-graph-layout";
import type {
  Flowchart,
  StateMachine,
  StateMachineTransition,
  Swimlane,
} from "@exadev/process-graph-projection";
import type { NamedElement } from "@exadev/process-graph-react";
import { elementLabel } from "@exadev/process-graph-react";
import type {
  Element,
  IdSpace,
  Model,
  Point,
} from "@exadev/process-graph-schema";
import {
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeHandle,
} from "@xyflow/react";

/** A view React Flow draws: a flowchart, a swimlane or a state machine, with its notation. */
export type FlowView<I extends IdSpace> =
  | { readonly notation: "flowchart"; readonly view: Flowchart<I> }
  | { readonly notation: "swimlane"; readonly view: Swimlane<I> }
  | { readonly notation: "stateMachine"; readonly view: StateMachine<I> };

/** What an element node shows. Node and edge data are `Readonly` mapped types rather than interfaces, because React Flow requires data assignable to `Record<string, unknown>`, which an interface is not. */
export type ElementNodeData<I extends IdSpace> = Readonly<{
  element: Element<I["element"], I>;
  status: Status;
  critical: boolean;
  /** The open work it waits on; absent when it is not blocked. */
  blockedBy?: readonly NamedElement[];
}>;

/** An element of the view, drawn as a styled element card. */
export type ElementNode<I extends IdSpace> = Node<
  ElementNodeData<I>,
  "element"
>;

/** What a lane node shows. */
export type LaneNodeData = Readonly<{
  participant: string;
  label: string;
}>;

/** A swimlane, drawn as a group node that holds the nodes of its participant's elements. */
export type LaneNode = Node<LaneNodeData, "lane">;

/** A node of a process view. */
export type ProcessNode<I extends IdSpace> = ElementNode<I> | LaneNode;

/** What a transition edge shows. */
export type TransitionEdgeData = Readonly<{
  /** The model transitions the edge stands for. */
  transitions: readonly string[];
  label?: string;
  /** Whether it passes work between actors; only a swimlane marks hand-offs. */
  handoff: boolean;
  /** Whether it joins two consecutive elements of the critical path. */
  critical: boolean;
}>;

/** A transition of the view, drawn as a labelled edge. */
export type TransitionEdge = Edge<TransitionEdgeData, "transition">;

/** What a view is drawn from besides its projection and its layout: the run's state. */
export interface FlowRun<I extends IdSpace> {
  readonly model: Model<I>;
  readonly statuses: ReadonlyMap<I["element"], Status>;
  /** The critical path, in dependency order. */
  readonly criticalPath: readonly I["element"][];
  /** Each blocked element's blockers, from `useBlockers`. */
  readonly blockers: ReadonlyMap<I["element"], readonly I["element"][]>;
  /** The elements to show; the others are hidden, and so is every edge with a hidden end. */
  readonly shown: ReadonlySet<I["element"]>;
  /** The direction the view was laid out in, which decides the side each edge leaves and enters a node. */
  readonly direction: Direction;
}

/** The side an edge enters a node, and the side it leaves, for each layout direction. */
const sides: Readonly<
  Record<Direction, { readonly target: Position; readonly source: Position }>
> = {
  right: { target: Position.Left, source: Position.Right },
  down: { target: Position.Top, source: Position.Bottom },
  left: { target: Position.Right, source: Position.Left },
  up: { target: Position.Bottom, source: Position.Top },
};

/** The middle of each side of a box, relative to the box. */
const anchors: Readonly<Record<Position, (size: Size) => Point>> = {
  [Position.Left]: (size) => ({ x: 0, y: size.height / 2 }),
  [Position.Right]: (size) => ({ x: size.width, y: size.height / 2 }),
  [Position.Top]: (size) => ({ x: size.width / 2, y: 0 }),
  [Position.Bottom]: (size) => ({ x: size.width / 2, y: size.height }),
};

/** A node's handles, given up front so React Flow can route edges without measuring the node first. */
const handlesOf = (direction: Direction, size: Size): NodeHandle[] => {
  const { target, source } = sides[direction];

  return [
    { type: "target", position: target, ...anchors[target](size) },
    { type: "source", position: source, ...anchors[source](size) },
  ];
};

const laneId = (participant: string): string => `lane:${participant}`;

const required = <V>(value: V | undefined, what: string): V => {
  if (value === undefined) {
    throw new Error(`The layout has no ${what}`);
  }

  return value;
};

/** The label of a state machine transition in the notation's form: `event [guard] / effect`. */
const transitionLabel = <I extends IdSpace>(
  model: Model<I>,
  transition: StateMachineTransition<I>,
): string | undefined => {
  const event = model.events.find(
    (candidate) => candidate.id === transition.event,
  );
  const effect = model.actions.find(
    (candidate) => candidate.id === transition.effect,
  );
  const label = [
    event?.name,
    transition.guard === undefined ? undefined : `[${transition.guard}]`,
    effect === undefined ? undefined : `/ ${effect.name}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");

  return label === "" ? undefined : label;
};

/**
 * The React Flow nodes and edges of a laid-out view: a node per element at its laid-out position and size, a group node per swimlane lane holding its participant's elements, and an edge per drawn edge or transition. Each element node carries its status, whether it is on the critical path and what it is blocked by; each edge whether it is a hand-off and whether it is on the critical path. Group nodes come before the nodes they hold, as React Flow requires.
 * @param flow - The projected view.
 * @param placement - The view's layout.
 * @param run - The run's state and the elements to show.
 * @returns The nodes and edges.
 * @throws Error when the layout lacks a position, size or lane the view needs.
 */
export const toFlow = <I extends IdSpace>(
  flow: FlowView<I>,
  placement: LayoutResult<I>,
  run: FlowRun<I>,
): {
  readonly nodes: ProcessNode<I>[];
  readonly edges: TransitionEdge[];
} => {
  const { model, statuses, criticalPath, blockers, shown, direction } = run;
  const positions = required(placement.views[flow.notation], "positions");
  const elements = new Map(
    model.elements.map((element) => [element.id, element]),
  );
  const step = new Map(criticalPath.map((id, index) => [id, index]));
  const sideOf = sides[direction];

  const laneOf = new Map<I["element"], LaneBounds<I>>();
  const lanes: LaneNode[] = [];
  if (flow.notation === "swimlane") {
    flow.view.lanes.forEach((lane, index) => {
      const bounds = required(
        placement.lanes[index],
        `lane for ${lane.participant}`,
      );
      for (const node of lane.nodes) {
        laneOf.set(node, bounds);
      }
      lanes.push({
        id: laneId(lane.participant),
        type: "lane",
        position: { x: bounds.x, y: bounds.y },
        width: bounds.width,
        height: bounds.height,
        selectable: false,
        focusable: false,
        draggable: false,
        data: { participant: lane.participant, label: lane.label },
      });
    });
  }

  const ids =
    flow.notation === "stateMachine"
      ? flow.view.states.map((state) => state.id)
      : flow.view.nodes.map((node) => node.id);
  const labelOf = (id: I["element"]): string =>
    elementLabel(required(elements.get(id), `element ${id} in the model`));
  const elementNodes = ids.map((id): ElementNode<I> => {
    const element = required(elements.get(id), `element ${id} in the model`);
    const status = required(statuses.get(id), `status for ${id}`);
    const size = required<Size>(placement.sizes[id], `size for ${id}`);
    const at = required<Point>(positions[id], `position for ${id}`);
    const lane = laneOf.get(id);
    const blockedBy = blockers.get(id);

    return {
      id,
      type: "element",
      position:
        lane === undefined ? at : { x: at.x - lane.x, y: at.y - lane.y },
      ...(lane === undefined
        ? {}
        : { parentId: laneId(lane.participant), extent: "parent" as const }),
      width: size.width,
      height: size.height,
      handles: handlesOf(direction, size),
      sourcePosition: sideOf.source,
      targetPosition: sideOf.target,
      hidden: !shown.has(id),
      draggable: false,
      ariaLabel: `${elementLabel(element)}, ${status}`,
      data: {
        element,
        status,
        critical: step.has(id),
        ...(blockedBy === undefined
          ? {}
          : {
              blockedBy: blockedBy.map((blocker) => ({
                id: blocker,
                label: labelOf(blocker),
              })),
            }),
      },
    };
  });

  const handoffs = new Set<string>(
    flow.notation === "swimlane"
      ? flow.view.handoffs.map((handoff) => handoff.transition)
      : [],
  );
  const onCriticalPath = (from: I["element"], to: I["element"]): boolean => {
    const at = step.get(from);

    return at !== undefined && step.get(to) === at + 1;
  };
  const drawn =
    flow.notation === "stateMachine"
      ? flow.view.transitions.map((transition) => ({
          from: transition.source,
          to: transition.target,
          transitions: transition.transitions,
          label: transitionLabel(model, transition),
        }))
      : flow.view.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          transitions: edge.transitions,
          label: edge.label,
        }));
  const edges = drawn.map((edge): TransitionEdge => {
    const critical = onCriticalPath(edge.from, edge.to);
    const handoff = edge.transitions.some((id) => handoffs.has(id));

    return {
      id: `transition:${edge.transitions.join(",")}`,
      type: "transition",
      source: edge.from,
      target: edge.to,
      hidden: !shown.has(edge.from) || !shown.has(edge.to),
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        transitions: edge.transitions,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        handoff,
        critical,
      },
    };
  });

  return { nodes: [...lanes, ...elementNodes], edges };
};
