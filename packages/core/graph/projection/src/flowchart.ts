import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import { commonLoss, unrepresentedLoss, type Loss } from "./loss.ts";

export interface FlowNode<I extends IdSpace> {
  readonly id: I["element"];
  readonly label: string;
  readonly shape: "terminator" | "process" | "decision" | "bar";
}

export interface FlowEdge<I extends IdSpace> {
  readonly from: I["element"];
  readonly to: I["element"];
  readonly label?: string;
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
 * @param nodes - The nodes the projection drew.
 */
export const flowchartLoss = <I extends IdSpace>(
  model: Model<I>,
  notation: "flowchart" | "swimlane",
  nodes: readonly FlowNode<I>[],
): readonly Loss<I>[] => [
  ...commonLoss(model, notation),
  ...unrepresentedLoss(
    model,
    notation,
    new Set<I["element"]>(nodes.map((node) => node.id)),
  ),
];

/**
 * Activities, decisions and terminators, joined by the transitions between them. `state` elements and `history` pseudo-states have no flowchart shape and are reported as unrepresented, with the transitions that touch them.
 */
export const toFlowchart = <I extends IdSpace>(
  model: Model<I>,
): Flowchart<I> => {
  const nodes: FlowNode<I>[] = [];
  for (const element of model.elements) {
    const node = flowNode<I>(element);
    if (node !== undefined) {
      nodes.push(node);
    }
  }

  const included = new Set<I["element"]>(nodes.map((node) => node.id));
  const edges: FlowEdge<I>[] = [];
  for (const transition of model.transitions) {
    if (included.has(transition.source) && included.has(transition.target)) {
      edges.push(
        transition.guard === undefined
          ? { from: transition.source, to: transition.target }
          : {
              from: transition.source,
              to: transition.target,
              label: transition.guard,
            },
      );
    }
  }

  return { nodes, edges, loss: flowchartLoss(model, "flowchart", nodes) };
};
