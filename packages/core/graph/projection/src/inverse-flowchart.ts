import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import type { ElementChange, ModelDiff, TransitionChange } from "./diff.ts";
import {
  flowchartParts,
  type EdgeOrigin,
  type FlowEdge,
  type FlowNode,
} from "./flowchart.ts";
import type { Swimlane } from "./swimlane.ts";

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
  const parts = flowchartParts(model);
  const original = parts.flowchart;
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
  const transitions = new Map(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  // Edges are matched by where they come from: the transition they start with and the node they end at, read from the projection's own record for the original edges, so an edge through messages is never built just to be compared.
  const keyOf = (first: I["transition"], target: I["element"]): string =>
    JSON.stringify([first, target]);
  const originals = new Map<
    string,
    { readonly edge: FlowEdge<I>; readonly origin: EdgeOrigin<I> }
  >();
  for (const [position, origin] of parts.origins.entries()) {
    const edge = original.edges[position];
    if (edge !== undefined) {
      originals.set(keyOf(origin.first.id, origin.target), { edge, origin });
    }
  }
  /** An edited edge's key: its first transition and the node one of its transitions arrives at, or `undefined` for an edge whose first transition is new. */
  const editedKey = (edge: FlowEdge<I>): string | undefined => {
    const [first] = edge.transitions;
    if (first === undefined || !transitions.has(first)) {
      return undefined;
    }
    for (const id of edge.transitions) {
      const target = transitions.get(id)?.target;
      if (target !== undefined && drawn.has(target)) {
        return keyOf(first, target);
      }
    }

    return undefined;
  };
  const editedKeys = new Set<string | undefined>(edited.edges.map(editedKey));
  // Omitted edges are grouped by how they end before anything is removed: an edge that is one transition removes it; edges that carry messages share their steps into an end, so each such end has its arriving steps removed once, however many of its edges were omitted, and which of them is a choice: inferred.
  const removed = new Set<I["transition"]>();
  const endsLeft = new Set<I["element"]>();
  for (const [key, { origin }] of originals) {
    if (editedKeys.has(key)) {
      continue;
    }
    if (origin.first.target !== origin.target) {
      endsLeft.add(origin.target);
    } else if (!removed.has(origin.first.id)) {
      removed.add(origin.first.id);
      transitionChanges.push({
        kind: "removed",
        transition: origin.first.id,
        inferred: false,
      });
    }
  }
  for (const end of endsLeft) {
    for (const transition of parts.index.arriving(end)) {
      if (!removed.has(transition.id)) {
        removed.add(transition.id);
        transitionChanges.push({
          kind: "removed",
          transition: transition.id,
          inferred: true,
        });
      }
    }
  }
  // Where the edges into each end that carry messages were moved to, so the shared steps into that end are rewired once.
  const movedEnds = new Map<I["element"], I["element"]>();
  for (const edge of edited.edges) {
    const key = editedKey(edge);
    const before = key === undefined ? undefined : originals.get(key);
    const [first, ...rest] = edge.transitions;
    if (before === undefined) {
      if (
        first === undefined ||
        rest.length > 0 ||
        transitions.has(first) ||
        edge.through !== undefined
      ) {
        throw new Error(
          `Edge ${JSON.stringify(edge.transitions)} is neither an edge of the model nor a new edge with a single new transition id`,
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
    const { origin } = before;
    const head = origin.first;
    const chain = head.target !== origin.target;
    if (!chain) {
      if (before.edge.from !== edge.from || before.edge.to !== edge.to) {
        transitionChanges.push({
          kind: "rewired",
          transition: head.id,
          from: { source: head.source, target: head.target },
          to: { source: edge.from, target: edge.to },
          inferred: false,
        });
      }
      if (before.edge.label !== edge.label) {
        transitionChanges.push({
          kind: "changed",
          field: "guard",
          transition: head.id,
          from: head.guard,
          to: edge.label,
          inferred: false,
        });
      }
      continue;
    }
    if (before.edge.label !== edge.label) {
      throw new Error(
        `Edge ${JSON.stringify(edge.transitions)} carries a message; edit the message or its steps rather than the edge's label`,
      );
    }
    if (head.source !== edge.from) {
      transitionChanges.push({
        kind: "rewired",
        transition: head.id,
        from: { source: head.source, target: head.target },
        to: { source: edge.from, target: head.target },
        inferred: false,
      });
    }
    if (origin.target === edge.to) {
      continue;
    }
    // The arriving steps are shared with every other edge through the same messages, so moving them is a choice: inferred, and made once per end however many of its edges moved.
    const already = movedEnds.get(origin.target);
    if (already === edge.to) {
      continue;
    }
    if (already !== undefined) {
      throw new Error(
        `Edges ending at "${origin.target}" through the same steps were moved to different ends, "${already}" and "${edge.to}"`,
      );
    }
    movedEnds.set(origin.target, edge.to);
    for (const tail of parts.index.arriving(origin.target)) {
      transitionChanges.push({
        kind: "rewired",
        transition: tail.id,
        from: { source: tail.source, target: tail.target },
        to: { source: tail.source, target: edge.to },
        inferred: true,
      });
    }
  }

  return { elements: elementChanges, transitions: transitionChanges };
};

/**
 * The inverse of `toFlowchart`: what an edited flowchart changes in the model, matched by element and transition id.
 *
 * A node not in the projection is an added element: a process an activity, a decision a decision, both certain; a terminator or bar a pseudo-state whose role is inferred from its edges. A projected node missing from the edit is removed, and a changed label renames the element. An edge is matched by where it comes from: the transition it starts with and the node one of its transitions arrives at. A new edge must carry one new transition id and is an added transition; a projected edge missing from the edit removes its transition; moved ends rewire it; a changed label changes its guard. An edge that carries messages stands for every route through them, so its earlier steps are shared with other edges: moving its source rewires its first transition, which is certain, while removing it or moving its target acts on each step from a message into its end, once however many edges share them, and is inferred.
 * @param model - The model the flowchart was projected from.
 * @param edited - The projected flowchart after editing. Its `loss` is not read.
 * @returns The changes, with no event changes, since a flowchart draws no events.
 * @throws Error when the edit cannot be expressed in the model: a node that is a model element the flowchart does not draw, a changed shape, a relabelled terminator or bar, an unmatched edge that is not a single new transition, a relabelled edge that carries a message, or edges sharing their last steps moved to different ends.
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
