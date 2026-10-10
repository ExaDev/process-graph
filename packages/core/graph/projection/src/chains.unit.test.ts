import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { chainIndex } from "./chains.ts";
import {
  diffFlowchart,
  handoffs,
  toFlowchart,
  toStateMachine,
} from "./index.ts";

/** Enough teeth that a list copied per message would hold far more references than the comb has elements. */
const combLength = 300;

/** Message layers between the drawn ends; the routes from one end to the other number `width` to the power of this, so enumerating them is out of reach long before the model is large. */
const layers = 8;
/** Message elements per layer, each joined to every one in the next layer. */
const width = 3;

const messageId = (layer: number, slot: number): string =>
  `m-${String(layer)}-${String(slot)}`;
const slots = Array.from({ length: width }, (_, slot) => slot);
const depths = Array.from({ length: layers }, (_, layer) => layer);
const sources = ["a-s1", "a-s2"];
const ends = ["a-e1", "a-e2"];

/**
 * Two customer steps, each entering the first message layer at its own message, then message layers each fully joined to the next, then two shop steps every last-layer message leads to. Every message is folded by every notation, so each drawn source reaches each drawn end through every route across the layers.
 */
const layered: Model<OpenIds> = {
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    ...sources.map((id) => ({
      kind: "activity" as const,
      id,
      label: id,
      actor: "customer",
    })),
    ...depths.flatMap((layer) =>
      slots.map((slot) => ({
        kind: "message" as const,
        id: messageId(layer, slot),
        label: messageId(layer, slot),
        from: "customer",
        to: "shop",
        mode: "async" as const,
      })),
    ),
    ...ends.map((id) => ({
      kind: "activity" as const,
      id,
      label: id,
      actor: "shop",
    })),
  ],
  transitions: [
    ...sources.map((source, slot) => ({
      id: `in-${source}`,
      source,
      target: messageId(0, slot),
    })),
    ...depths.slice(1).flatMap((layer) =>
      slots.flatMap((from) =>
        slots.map((to) => ({
          id: `t-${messageId(layer - 1, from)}-${String(to)}`,
          source: messageId(layer - 1, from),
          target: messageId(layer, to),
        })),
      ),
    ),
    ...slots.flatMap((slot) =>
      ends.map((end) => ({
        id: `out-${messageId(layers - 1, slot)}-${end}`,
        source: messageId(layers - 1, slot),
        target: end,
      })),
    ),
  ],
  fragments: [],
  projections: [],
};

const pairs = sources.flatMap((source) => ends.map((end) => [source, end]));

describe("chains through a layered acyclic graph of message elements", () => {
  it("asks whether each element is folded once, and reaches every end from each source as one merged chain", () => {
    const messages = new Set(
      layered.elements.flatMap((element) =>
        element.kind === "message" ? [element.id] : [],
      ),
    );
    const visits = new Map<string, number>();
    const index = chainIndex(layered, {
      folded: (element) => {
        visits.set(element, (visits.get(element) ?? 0) + 1);

        return messages.has(element);
      },
      accepted: (element) => ends.includes(element),
    });
    for (const first of layered.transitions.filter((transition) =>
      sources.includes(transition.source),
    )) {
      const chains = index.from(first);

      expect(chains.map((chain) => chain.target)).toEqual(ends);
      expect(chains.every((chain) => chain.merged)).toBe(true);
    }
    expect([...visits.values()].every((count) => count === 1)).toBe(true);
    expect(visits.size).toBe(layered.elements.length);
  });

  it("draws one flowchart edge per distinct drawn source and target, carrying every message on its routes", () => {
    const flow = toFlowchart(layered);

    expect(flow.edges.map((edge) => [edge.from, edge.to])).toEqual(pairs);
    const [edge] = flow.edges;
    expect(new Set(edge?.through)).toEqual(
      new Set([
        messageId(0, 0),
        ...depths
          .slice(1)
          .flatMap((layer) => slots.map((slot) => messageId(layer, slot))),
      ]),
    );
    // Only the sources enter the first layer, so its last message is reached by no step.
    expect(flow.loss).toEqual([
      { kind: "message-elements", elements: [messageId(0, width - 1)] },
    ]);
  });

  it("derives one hand-off and one state machine transition per distinct pair", () => {
    expect(
      handoffs(layered).map((handoff) => [handoff.transition, handoff.to]),
    ).toEqual(
      sources.flatMap((source) => ends.map(() => [`in-${source}`, "shop"])),
    );
    expect(
      toStateMachine(layered, "order").transitions.map((transition) => [
        transition.source,
        transition.target,
      ]),
    ).toEqual(pairs);
  });

  it("removes only the steps arriving at its end when a merged edge is removed, as inferred changes", () => {
    const flow = toFlowchart(layered);
    const diff = diffFlowchart(layered, {
      nodes: flow.nodes,
      edges: flow.edges.filter(
        (edge) => !(edge.from === "a-s1" && edge.to === "a-e1"),
      ),
    });

    expect(diff.transitions).toEqual(
      slots.map((slot) => ({
        kind: "removed",
        transition: `out-${messageId(layers - 1, slot)}-a-e1`,
        inferred: true,
      })),
    );
  });
});

describe("a merged chain's labels", () => {
  /** One step into a decision whose two guarded branches each pass through their own message and meet again at the next step. */
  const diamond: Model<OpenIds> = {
    participants: [{ id: "order", label: "Order", kind: "entity" }],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "a", label: "A" },
      { kind: "decision", id: "d", label: "D" },
      ...["m-yes", "m-no"].map((id) => ({
        kind: "message" as const,
        id,
        label: id,
        from: "x",
        to: "y",
        mode: "async" as const,
      })),
      { kind: "activity", id: "b", label: "B" },
    ],
    transitions: [
      { id: "t1", source: "a", target: "d" },
      { id: "t2", source: "d", target: "m-yes", guard: "yes" },
      { id: "t3", source: "d", target: "m-no", guard: "no" },
      { id: "t4", source: "m-yes", target: "b" },
      { id: "t5", source: "m-no", target: "b" },
    ],
    fragments: [],
    projections: [],
  };

  it("draws the routes as one state machine transition carrying no guard, since its guards belong to different routes", () => {
    expect(toStateMachine(diamond, "order").transitions).toEqual([
      {
        source: "a",
        target: "b",
        transitions: ["t1", "t2", "t4", "t3", "t5"],
        through: ["d", "m-yes", "m-no"],
      },
    ]);
  });
});

/** Messages in a line, each with its own exit to an activity, entered from one activity: the reachable targets grow by one at every message. */
const comb = (
  length: number,
): { readonly model: Model<OpenIds>; readonly ends: string[] } => {
  const teeth = Array.from({ length }, (_, index) => `m-${String(index)}`);
  const exits = teeth.map((id) => `e-${id}`);

  return {
    model: {
      participants: [],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "activity", id: "s", label: "S" },
        ...teeth.map((id) => ({
          kind: "message" as const,
          id,
          label: id,
          from: "x",
          to: "y",
          mode: "async" as const,
        })),
        ...exits.map((id) => ({ kind: "activity" as const, id, label: id })),
      ],
      transitions: [
        { id: "t-in", source: "s", target: "m-0" },
        ...teeth.flatMap((id, index) => [
          { id: `t-${id}-out`, source: id, target: `e-${id}` },
          ...(index + 1 < length
            ? [{ id: `t-${id}-on`, source: id, target: teeth[index + 1] ?? id }]
            : []),
        ]),
      ],
      fragments: [],
      projections: [],
    },
    ends: exits,
  };
};

/** Two combs of the same length entered from one message and joined again at a last message, whose teeth exit to the same activities, so merging their targets must remove duplicates. */
const diamondOfCombs = (
  length: number,
): { readonly model: Model<OpenIds>; readonly ends: string[] } => {
  const shared = Array.from({ length }, (_, index) => `e-${String(index)}`);
  const arm = (side: string): string[] =>
    shared.map((_, index) => `${side}-${String(index)}`);
  const left = arm("l");
  const right = arm("r");
  const message = (id: string) => ({
    kind: "message" as const,
    id,
    label: id,
    from: "x",
    to: "y",
    mode: "async" as const,
  });
  const teeth = (side: readonly string[]) =>
    side.flatMap((id, index) => [
      { id: `t-${id}-out`, source: id, target: shared[index] ?? id },
      {
        id: `t-${id}-on`,
        source: id,
        target: side[index + 1] ?? "join",
      },
    ]);

  return {
    model: {
      participants: [],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "activity", id: "s", label: "S" },
        message("fork"),
        ...left.map(message),
        ...right.map(message),
        message("join"),
        ...shared.map((id) => ({ kind: "activity" as const, id, label: id })),
        { kind: "activity", id: "last", label: "Last" },
      ],
      transitions: [
        { id: "t-in", source: "s", target: "fork" },
        { id: "t-left", source: "fork", target: left[0] ?? "join" },
        { id: "t-right", source: "fork", target: right[0] ?? "join" },
        ...teeth(left),
        ...teeth(right),
        { id: "t-last", source: "join", target: "last" },
      ],
      fragments: [],
      projections: [],
    },
    ends: [...shared, "last"],
  };
};

/** References the index stores building and reading the targets from the entry activity. */
const storedReferences = (model: Model<OpenIds>): number => {
  let stored = 0;
  const messages = new Set(
    model.elements.flatMap((element) =>
      element.kind === "message" ? [element.id] : [],
    ),
  );
  const index = chainIndex(model, {
    folded: (element) => messages.has(element),
    accepted: (element) => !messages.has(element),
    observe: (references) => {
      stored += references;
    },
  });
  for (const first of model.transitions.filter(
    (transition) => transition.source === "s",
  )) {
    index.from(first);
  }

  return stored;
};

/** Doubling a model of linear size may at most double what the index stores. */
const doubling = 2;

describe("the index's stored size", () => {
  it("stays linear for a comb whose targets grow at every message", () => {
    expect(
      storedReferences(comb(doubling * combLength).model),
    ).toBeLessThanOrEqual(doubling * storedReferences(comb(combLength).model));
  });

  it("stays linear for a diamond of combs", () => {
    expect(
      storedReferences(diamondOfCombs(doubling * combLength).model),
    ).toBeLessThanOrEqual(
      doubling * storedReferences(diamondOfCombs(combLength).model),
    );
  });

  it("reaches every tooth of a comb in order", () => {
    const { model, ends: teeth } = comb(combLength);

    expect(toFlowchart(model).edges.map((edge) => edge.to)).toEqual(teeth);
  });

  it("reaches each shared end of a diamond of combs once, in order, then the end after the join", () => {
    const { model, ends: reached } = diamondOfCombs(combLength);

    expect(toFlowchart(model).edges.map((edge) => edge.to)).toEqual(reached);
  });
});
