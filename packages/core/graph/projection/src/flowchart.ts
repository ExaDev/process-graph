import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import {
  chainIndex,
  once,
  type Chain,
  type ChainIndex,
  type TransitionOf,
} from "./chains.ts";
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

/** What a flowchart-shaped projection drew, for working out what it dropped. */
export interface Drawn<I extends IdSpace> {
  readonly nodes: readonly FlowNode<I>[];
  /** The message elements some edge carries, which are shown. */
  readonly carried: ReadonlySet<I["element"]>;
  /** The message elements left unfolded because folding them would multiply edges, reported as unrepresented instead. */
  readonly unfolded: ReadonlySet<I["element"]>;
}

/**
 * What a flowchart-shaped projection drops: the common losses, then the elements the flowchart has no node for (`state` elements and `history` pseudo-states) and the transitions that touch them.
 * @param model - The model projected.
 * @param notation - The notation the result is for, `flowchart` or `swimlane`.
 * @param drawn - What the projection drew.
 */
export const flowchartLoss = <I extends IdSpace>(
  model: Model<I>,
  notation: "flowchart" | "swimlane",
  drawn: Drawn<I>,
): readonly Loss<I>[] => [
  ...commonLoss(model, notation, {
    fragments: new Set(),
    messages: new Set([...drawn.carried, ...drawn.unfolded]),
  }),
  ...unrepresentedLoss(
    model,
    notation,
    new Set<I["element"]>(drawn.nodes.map((node) => node.id)),
    drawn.unfolded,
  ),
];

/** Where a drawn edge comes from: the transition it starts with and the node it ends at. */
export interface EdgeOrigin<I extends IdSpace> {
  readonly first: TransitionOf<I>;
  readonly target: I["element"];
}

/** A flowchart with what its inverse and the swimlane need beside it. */
export interface FlowchartParts<I extends IdSpace> {
  readonly flowchart: Flowchart<I>;
  /** Each edge's origin, in edge order. */
  readonly origins: readonly EdgeOrigin<I>[];
  readonly index: ChainIndex<I>;
  /** The message elements some edge carries. */
  readonly carried: ReadonlySet<I["element"]>;
}

/**
 * The edge a chain draws. On a single route its label is the route's guards joined with "and", or, when none is guarded, the labels of the messages on it; where several routes are merged the guards belong to different routes and cannot be joined, so the label is the carried messages' labels. An edge through messages builds its lists and label only when they are read, so edges sharing a long run of messages do not each copy it.
 */
const edgeOf = <I extends IdSpace>(
  chain: Chain<I>,
  messageLabels: ReadonlyMap<I["element"], string>,
): FlowEdge<I> => {
  const from = chain.first.source;
  if (chain.first.target === chain.target) {
    const { guard } = chain.first;

    return {
      from,
      to: chain.target,
      ...(guard === undefined ? {} : { label: guard }),
      transitions: [chain.first.id],
    };
  }
  const ids = once(() =>
    chain.transitions().map((transition) => transition.id),
  );
  const label = once(() => {
    if (!chain.merged && chain.guarded) {
      return chain.guards().join(" and ");
    }

    return chain
      .through()
      .flatMap((id) => {
        const message = messageLabels.get(id);

        return message === undefined ? [] : [message];
      })
      .join(", ");
  });

  return {
    from,
    to: chain.target,
    get label(): string {
      return label();
    },
    get transitions(): readonly I["transition"][] {
      return ids();
    },
    get through(): readonly I["element"][] {
      return chain.through();
    },
  };
};

/**
 * The flowchart and the parts its inverse needs.
 * @param model - The model to project.
 */
export const flowchartParts = <I extends IdSpace>(
  model: Model<I>,
): FlowchartParts<I> => {
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
  const index = chainIndex(model, {
    folded: (id) => messageLabels.has(id),
    accepted: (id) => included.has(id),
  });
  const firsts = model.transitions.filter((transition) =>
    included.has(transition.source),
  );
  const edges: FlowEdge<I>[] = [];
  const origins: EdgeOrigin<I>[] = [];
  for (const first of firsts) {
    for (const chain of index.from(first)) {
      edges.push(edgeOf(chain, messageLabels));
      origins.push({ first, target: chain.target });
    }
  }
  const carried = index.carried(firsts);

  return {
    flowchart: {
      nodes,
      edges,
      loss: flowchartLoss(model, "flowchart", {
        nodes,
        carried,
        unfolded: index.unfolded,
      }),
    },
    origins,
    index,
    carried,
  };
};

/**
 * Activities, decisions and terminators, joined by the transitions between them. A `message` element is not a node: a transition into it continues through it, so the edge runs from the step before the message to the step after it and carries the message (`through`). There is one edge per transition leaving a node and node it leads to, however many routes through message elements connect them; such an edge's `transitions`, `through` and `label` are built when first read. A message element no edge carries is reported as a `message-elements` loss. `state` elements and `history` pseudo-states have no flowchart shape and are reported as unrepresented, with the transitions that touch them.
 * @param model - The model to project.
 * @returns The nodes in model order, the edges in the order of the transitions they start with, and what was dropped.
 */
export const toFlowchart = <I extends IdSpace>(model: Model<I>): Flowchart<I> =>
  flowchartParts(model).flowchart;
