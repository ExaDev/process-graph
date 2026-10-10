import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import { chainsFrom, outgoingMap, type Chain } from "./chains.ts";
import { commonLoss, unrepresentedLoss, type Loss } from "./loss.ts";

export interface FlowNode<I extends IdSpace> {
  readonly id: I["element"];
  readonly label: string;
  readonly shape: "terminator" | "process" | "decision" | "bar";
}

/** A drawn edge. It stands for one model transition, or for a chain of them through `message` elements, which a flowchart draws as the edge that carries the message rather than as a node. */
export interface FlowEdge<I extends IdSpace> {
  readonly from: I["element"];
  readonly to: I["element"];
  /** On a single route, its guards joined with "and", or, when there are none, the labels of the messages it carries. On several merged routes, the labels of the messages it carries. */
  readonly label?: string;
  /** The model transitions the edge stands for: one, or every transition on some route through the message elements it carries, each once, in the order they were met. An edit to the edge maps back to the model through these. */
  readonly transitions: readonly I["transition"][];
  /** The `message` elements the edge carries, each once, in the order they were met, when it stands for more than one transition. */
  readonly through?: readonly I["element"][];
}

export interface Flowchart<I extends IdSpace> {
  readonly nodes: readonly FlowNode<I>[];
  readonly edges: readonly FlowEdge<I>[];
  /** What the projection dropped from the model. */
  readonly loss: readonly Loss<I>[];
}

const flowNode = <I extends IdSpace>(
  element: ElementOf<I>,
): FlowNode<I> | undefined => {
  switch (element.kind) {
    case "activity":
      return { id: element.id, label: element.label, shape: "process" };
    case "decision":
      return { id: element.id, label: element.label, shape: "decision" };
    case "pseudo":
      switch (element.role) {
        case "initial":
          return { id: element.id, label: "Start", shape: "terminator" };
        case "final":
          return { id: element.id, label: "End", shape: "terminator" };
        case "fork":
          return { id: element.id, label: "Fork", shape: "bar" };
        case "join":
          return { id: element.id, label: "Join", shape: "bar" };
        case "history":
          break;
      }
      break;
    case "state":
    case "message":
      break;
  }

  return undefined;
};

/**
 * What a flowchart-shaped projection drops: the common losses, then the elements the flowchart has no node for (`state` elements and `history` pseudo-states) and the transitions that touch them.
 * @param model - The model projected.
 * @param notation - The notation the result is for, `flowchart` or `swimlane`.
 * @param flow - The nodes and edges the projection drew; a message element an edge carries is shown.
 */
export const flowchartLoss = <I extends IdSpace>(
  model: Model<I>,
  notation: "flowchart" | "swimlane",
  flow: Readonly<Pick<Flowchart<I>, "nodes" | "edges">>,
): readonly Loss<I>[] => [
  ...commonLoss(model, notation, {
    fragments: new Set(),
    messages: new Set(flow.edges.flatMap((edge) => edge.through ?? [])),
  }),
  ...unrepresentedLoss(
    model,
    notation,
    new Set<I["element"]>(flow.nodes.map((node) => node.id)),
  ),
];

/** The edge a chain of transitions draws. On a single route its label is the route's guards joined with "and", or, when none is guarded, the carried messages' labels. Where several routes are merged the guards belong to different routes and cannot be joined, so the label is the carried messages' labels only. */
const edgeOf = <I extends IdSpace>(
  from: I["element"],
  chain: Chain<I>,
  messageLabels: ReadonlyMap<I["element"], string>,
): FlowEdge<I> => {
  const guards = chain.transitions.flatMap((transition) =>
    transition.guard === undefined ? [] : [transition.guard],
  );
  const carried = chain.through.flatMap((id) => {
    const label = messageLabels.get(id);

    return label === undefined ? [] : [label];
  });
  const label =
    guards.length > 0 && !chain.merged
      ? guards.join(" and ")
      : carried.length > 0
        ? carried.join(", ")
        : undefined;

  return {
    from,
    to: chain.target,
    ...(label === undefined ? {} : { label }),
    transitions: chain.transitions.map((transition) => transition.id),
    ...(chain.through.length === 0 ? {} : { through: chain.through }),
  };
};

/**
 * Activities, decisions and terminators, joined by the transitions between them. A `message` element is not a node: a transition into it continues through it, so the edge runs from the step before the message to the step after it and carries the message (`through`). There is one edge per transition leaving a node and drawn element it leads to, however many routes through message elements connect them. A message element no edge carries is reported as a `message-elements` loss. `state` elements and `history` pseudo-states have no flowchart shape and are reported as unrepresented, with the transitions that touch them.
 * @param model - The model to project.
 * @returns The nodes in model order, the edges in the order of the transitions they start with, and what was dropped.
 */
export const toFlowchart = <I extends IdSpace>(
  model: Model<I>,
): Flowchart<I> => {
  const nodes: FlowNode<I>[] = [];
  const messageLabels = new Map<I["element"], string>();
  for (const element of model.elements) {
    if (element.kind === "message") {
      messageLabels.set(element.id, element.label);
    }
    const node = flowNode<I>(element);
    if (node !== undefined) {
      nodes.push(node);
    }
  }

  const included = new Set<I["element"]>(nodes.map((node) => node.id));
  const outgoing = outgoingMap(model);
  const isMessage = (id: I["element"]): boolean => messageLabels.has(id);
  const edges: FlowEdge<I>[] = [];
  for (const transition of model.transitions) {
    if (!included.has(transition.source)) {
      continue;
    }
    for (const chain of chainsFrom(transition, outgoing, isMessage)) {
      if (included.has(chain.target)) {
        edges.push(edgeOf(transition.source, chain, messageLabels));
      }
    }
  }

  return {
    nodes,
    edges,
    loss: flowchartLoss(model, "flowchart", { nodes, edges }),
  };
};
