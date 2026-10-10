import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import type { TransitionOf } from "./chains.ts";
import type { ElementChange, ModelDiff, TransitionChange } from "./diff.ts";
import { toFlowchart, type FlowEdge, type FlowNode } from "./flowchart.ts";
import type { Swimlane } from "./swimlane.ts";

/** The key an edge is matched by across the original and the edited view: the transitions it stands for. */
const edgeKey = <I extends IdSpace>(edge: FlowEdge<I>): string =>
  JSON.stringify(edge.transitions);

/** How many edited edges arrive at and leave each node, counted in one pass over the edges. */
interface Degrees<I extends IdSpace> {
  readonly in: ReadonlyMap<I["element"], number>;
  readonly out: ReadonlyMap<I["element"], number>;
}

const degreesOf = <I extends IdSpace>(
  edges: readonly FlowEdge<I>[],
): Degrees<I> => {
  const incoming = new Map<I["element"], number>();
  const outgoing = new Map<I["element"], number>();
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  return { in: incoming, out: outgoing };
};

/** What an added node becomes, with whether the inverse had to choose. A terminator is a start when nothing arrives at it and an end otherwise; a bar is a fork when it has more ways out than in and a join otherwise. */
const addedElement = <I extends IdSpace>(
  node: FlowNode<I>,
  degrees: Degrees<I>,
  actor: I["actor"] | undefined,
): ElementChange<I> => {
  const owned = actor === undefined ? {} : { actor };
  if (node.shape === "process") {
    return {
      kind: "added",
      element: { kind: "activity", id: node.id, label: node.label, ...owned },
      inferred: false,
    };
  }
  if (node.shape === "decision") {
    return {
      kind: "added",
      element: { kind: "decision", id: node.id, label: node.label, ...owned },
      inferred: false,
    };
  }
  if (node.shape === "terminator") {
    return {
      kind: "added",
      element: {
        kind: "pseudo",
        id: node.id,
        role: (degrees.in.get(node.id) ?? 0) > 0 ? "final" : "initial",
      },
      inferred: true,
    };
  }
  const ins = degrees.in.get(node.id) ?? 0;
  const outs = degrees.out.get(node.id) ?? 0;

  return {
    kind: "added",
    element: {
      kind: "pseudo",
      id: node.id,
      role: outs > ins ? "fork" : "join",
    },
    inferred: true,
  };
};

/**
 * The element and transition changes shared by the flowchart and swimlane inverses. `actorOf` gives the actor an edited node is placed with, for the swimlane; the flowchart has none and passes a function that always returns `undefined`.
 */
const diffFlow = <I extends IdSpace>(
  model: Model<I>,
  edited: Readonly<{
    nodes: readonly FlowNode<I>[];
    edges: readonly FlowEdge<I>[];
  }>,
  actorOf: (node: I["element"]) => I["actor"] | undefined,
): Pick<ModelDiff<I>, "elements" | "transitions"> => {
  const original = toFlowchart(model);
  const elements = new Map<I["element"], ElementOf<I>>(
    model.elements.map((element) => [element.id, element]),
  );
  const drawn = new Map<I["element"], FlowNode<I>>(
    original.nodes.map((node) => [node.id, node]),
  );
  const kept = new Set<I["element"]>(edited.nodes.map((node) => node.id));
  const degrees = degreesOf(edited.edges);

  const elementChanges: ElementChange<I>[] = [];
  for (const node of original.nodes) {
    if (!kept.has(node.id)) {
      elementChanges.push({
        kind: "removed",
        element: node.id,
        inferred: false,
      });
    }
  }
  for (const node of edited.nodes) {
    const before = drawn.get(node.id);
    if (before === undefined) {
      if (elements.has(node.id)) {
        throw new Error(
          `Node "${node.id}" is a model element the flowchart does not draw`,
        );
      }
      elementChanges.push(addedElement(node, degrees, actorOf(node.id)));
      continue;
    }
    if (before.shape !== node.shape) {
      throw new Error(
        `Node "${node.id}" changed shape from ${before.shape} to ${node.shape}; an element's kind is its identity, so remove it and add one under a new id`,
      );
    }
    if (before.label !== node.label) {
      if (node.shape === "terminator" || node.shape === "bar") {
        throw new Error(
          `Node "${node.id}" is a ${node.shape}, whose label the projection supplies and the model does not hold`,
        );
      }
      elementChanges.push({
        kind: "renamed",
        element: node.id,
        from: before.label,
        to: node.label,
        inferred: false,
      });
    }
  }

  const transitionChanges: TransitionChange<I>[] = [];
  const originalEdges = new Map<string, FlowEdge<I>>(
    original.edges.map((edge) => [edgeKey(edge), edge]),
  );
  const editedKeys = new Set<string>(edited.edges.map(edgeKey));
  const transitions = new Map(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  /** The transitions of an edge that arrive at its drawn end: the edge's one transition, or the last step of each route through the messages it carries. */
  const arriving = (edge: FlowEdge<I>): TransitionOf<I>[] =>
    edge.transitions.flatMap((id) => {
      const transition = transitions.get(id);

      return transition?.target === edge.to ? [transition] : [];
    });
  for (const edge of original.edges) {
    if (!editedKeys.has(edgeKey(edge))) {
      // An edge that carries messages shares its earlier steps with every other edge through the same messages, so only the steps arriving at its end are removed, and which of them is a choice: inferred.
      for (const transition of arriving(edge)) {
        transitionChanges.push({
          kind: "removed",
          transition: transition.id,
          inferred: edge.transitions.length > 1,
        });
      }
    }
  }
  for (const edge of edited.edges) {
    const before = originalEdges.get(edgeKey(edge));
    const [first, ...rest] = edge.transitions;
    if (before === undefined) {
      if (
        first === undefined ||
        rest.length > 0 ||
        transitions.has(first) ||
        edge.through !== undefined
      ) {
        throw new Error(
          `Edge ${edgeKey(edge)} is neither an edge of the model nor a new edge with a single new transition id`,
        );
      }
      transitionChanges.push({
        kind: "added",
        transition: {
          id: first,
          source: edge.from,
          target: edge.to,
          ...(edge.label === undefined ? {} : { guard: edge.label }),
        },
        inferred: false,
      });
      continue;
    }
    const head = first === undefined ? undefined : transitions.get(first);
    if (head === undefined) {
      continue;
    }
    const chain = edge.transitions.length > 1;
    if (!chain && (before.from !== edge.from || before.to !== edge.to)) {
      transitionChanges.push({
        kind: "rewired",
        transition: head.id,
        from: { source: head.source, target: head.target },
        to: { source: edge.from, target: edge.to },
        inferred: false,
      });
    } else {
      if (before.from !== edge.from) {
        transitionChanges.push({
          kind: "rewired",
          transition: head.id,
          from: { source: head.source, target: head.target },
          to: { source: edge.from, target: head.target },
          inferred: false,
        });
      }
      if (before.to !== edge.to) {
        // The arriving steps are shared with every other edge through the same messages, so moving them is a choice: inferred.
        for (const tail of arriving(before)) {
          transitionChanges.push({
            kind: "rewired",
            transition: tail.id,
            from: { source: tail.source, target: tail.target },
            to: { source: tail.source, target: edge.to },
            inferred: true,
          });
        }
      }
    }
    if (before.label !== edge.label) {
      if (chain) {
        throw new Error(
          `Edge ${edgeKey(edge)} carries a message; edit the message or its steps rather than the edge's label`,
        );
      }
      transitionChanges.push({
        kind: "changed",
        field: "guard",
        transition: head.id,
        from: head.guard,
        to: edge.label,
        inferred: false,
      });
    }
  }

  return { elements: elementChanges, transitions: transitionChanges };
};

/**
 * The inverse of `toFlowchart`: what an edited flowchart changes in the model, matched by element and transition id.
 *
 * A node not in the projection is an added element: a process an activity, a decision a decision, both certain; a terminator or bar a pseudo-state whose role is inferred from its edges. A projected node missing from the edit is removed, and a changed label renames the element. An edge is matched by the transitions it stands for: a new edge must carry one new transition id and is an added transition; a projected edge missing from the edit removes its transition; moved ends rewire it; a changed label changes its guard. An edge that carries messages stands for every route through them, so its earlier steps are shared with other edges: moving its source rewires its first transition, which is certain, while removing it or moving its target acts on each step arriving at its end and is inferred.
 * @param model - The model the flowchart was projected from.
 * @param edited - The projected flowchart after editing. Its `loss` is not read.
 * @returns The changes, with no event changes, since a flowchart draws no events.
 * @throws Error when the edit cannot be expressed in the model: a node that is a model element the flowchart does not draw, a changed shape, a relabelled terminator or bar, an unmatched edge that is not a single new transition, or a relabelled edge that carries a message.
 */
export const diffFlowchart = <I extends IdSpace>(
  model: Model<I>,
  edited: Readonly<{
    nodes: readonly FlowNode<I>[];
    edges: readonly FlowEdge<I>[];
  }>,
): ModelDiff<I> => ({
  ...diffFlow(model, edited, () => undefined),
  events: [],
});

/**
 * The inverse of `toSwimlane`: the flowchart changes plus the lane moves. A node is placed with the actor of the lane it is in, or with none when it is in `unassigned`; an activity or decision whose actor differs from the model's is relaned, and an added activity or decision takes its lane's actor. Hand-offs are derived and not read.
 * @param model - The model the swimlane was projected from.
 * @param edited - The projected swimlane after editing.
 * @returns The changes; see `diffFlowchart` for nodes and edges.
 * @throws Error in the cases `diffFlowchart` does, when a lane belongs to a participant that cannot act, or when a pseudo-state is put in a lane.
 */
export const diffSwimlane = <I extends IdSpace>(
  model: Model<I>,
  edited: Readonly<Pick<Swimlane<I>, "nodes" | "edges" | "lanes">>,
): ModelDiff<I> => {
  const actors = new Set<string>([
    ...model.participants.flatMap((participant) =>
      participant.kind === "entity" ? [] : [participant.id],
    ),
    ...model.elements.flatMap((element) =>
      (element.kind === "activity" || element.kind === "decision") &&
      element.actor !== undefined
        ? [element.actor]
        : [],
    ),
  ]);
  const canAct = (
    participant: I["participant"] | I["actor"],
  ): participant is I["actor"] => actors.has(participant);

  const placed = new Map<I["element"], I["actor"]>();
  for (const lane of edited.lanes) {
    if (!canAct(lane.participant)) {
      throw new Error(
        `Lane "${lane.participant}" belongs to a participant that cannot act`,
      );
    }
    for (const node of lane.nodes) {
      placed.set(node, lane.participant);
    }
  }
  const flow = diffFlow(model, edited, (node) => placed.get(node));

  const relaned: ElementChange<I>[] = [];
  const shapes = new Map<I["element"], FlowNode<I>["shape"]>(
    edited.nodes.map((node) => [node.id, node.shape]),
  );
  for (const node of placed.keys()) {
    const shape = shapes.get(node);
    if (shape === "terminator" || shape === "bar") {
      throw new Error(
        `Node "${node}" is a pseudo-state and has no actor to put in a lane`,
      );
    }
  }
  for (const element of model.elements) {
    if (
      (element.kind !== "activity" && element.kind !== "decision") ||
      !shapes.has(element.id)
    ) {
      continue;
    }
    const to = placed.get(element.id);
    if (to !== element.actor) {
      relaned.push({
        kind: "relaned",
        element: element.id,
        from: element.actor,
        to,
        inferred: false,
      });
    }
  }

  return {
    elements: [...flow.elements, ...relaned],
    transitions: flow.transitions,
    events: [],
  };
};
