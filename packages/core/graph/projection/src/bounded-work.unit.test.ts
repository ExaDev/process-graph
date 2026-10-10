import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { sequenceObserved } from "./sequence.ts";
import {
  applyModelDiff,
  diffFlowchart,
  handoffs,
  toFlowchart,
  toSequence,
  toStateMachine,
  toSwimlane,
  type FlowEdge,
  type FlowNode,
  type ModelDiff,
} from "./index.ts";

/**
 * The work these tests measure is the number of item reads through a counting proxy. A fixed number of passes over the input reads exactly twice as many items when the input doubles; a scan of the whole input per item reads four times as many. Each test therefore compares a size with its double rather than holding a threshold.
 */
const size = 400;
/** When the input doubles, a fixed number of linear passes doubles the reads and a pass per item quadruples them; this lies midway, so growth below it is linear up to constant overheads and growth at or above it is quadratic. */
const growthLimit = 3;

/** A copy of `items` whose indexed reads are counted, and the count so far. */
const counted = <T>(
  items: readonly T[],
): { readonly items: readonly T[]; readonly reads: () => number } => {
  let reads = 0;
  const proxy = new Proxy([...items], {
    get: (target, key, receiver): unknown => {
      if (typeof key === "string" && /^\d+$/u.test(key)) {
        reads += 1;
      }

      return Reflect.get(target, key, receiver);
    },
  });

  return { items: proxy, reads: () => reads };
};

const ids = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index)}`);

const empty: Model<OpenIds> = {
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [],
  transitions: [],
  fragments: [],
  projections: [],
};

/** Edge reads `diffFlowchart` makes for an edit adding `count` bars joined in a ring. */
const barEdgeReads = (count: number): number => {
  const bars = ids(count, "bar-");
  const nodes: FlowNode<OpenIds>[] = bars.map((id) => ({
    id,
    label: "Fork",
    shape: "bar",
  }));
  // A ring, so the edges are exactly as many as the bars.
  const edges = counted<FlowEdge<OpenIds>>(
    bars.map((id, index) => ({
      from: id,
      to: bars[(index + 1) % count] ?? id,
      transitions: [`t-${id}`],
    })),
  );
  diffFlowchart(empty, { nodes, edges: edges.items });

  return edges.reads();
};

/** Change reads `applyModelDiff` makes renaming every one of `count` activities. */
const renameReads = (count: number): number => {
  const activities = ids(count, "a-");
  const model: Model<OpenIds> = {
    ...empty,
    elements: activities.map((id) => ({ kind: "activity", id, label: id })),
  };
  const changes = counted<ModelDiff<OpenIds>["elements"][number]>(
    activities.map((id) => ({
      kind: "renamed",
      element: id,
      from: id,
      to: `${id}!`,
      inferred: false,
    })),
  );
  applyModelDiff(model, {
    elements: changes.items,
    transitions: [],
    events: [],
  });

  return changes.reads();
};

describe("work grows in proportion to the input", () => {
  it("diffFlowchart reads the edited edges a fixed number of times however many bars are added", () => {
    expect(barEdgeReads(2 * size)).toBe(2 * barEdgeReads(size));
  });

  it("applyModelDiff reads each change a fixed number of times however many elements change", () => {
    expect(renameReads(2 * size)).toBe(2 * renameReads(size));
  });
});

/** A model whose transitions count every property read, and the count so far. */
const countingTransitions = (
  model: Model<OpenIds>,
): { readonly model: Model<OpenIds>; readonly reads: () => number } => {
  let reads = 0;

  return {
    model: {
      ...model,
      transitions: model.transitions.map(
        (transition) =>
          new Proxy(transition, {
            get: (target, key, receiver): unknown => {
              reads += 1;

              return Reflect.get(target, key, receiver);
            },
          }),
      ),
    },
    reads: () => reads,
  };
};

/** One decision with `count` forward branches that all lead into the same tail of `count` steps, and the path that takes the first branch down the tail. */
const sharedTail = (
  count: number,
): { readonly model: Model<OpenIds>; readonly path: string[] } => {
  const tail = ids(count, "tail-");
  const model: Model<OpenIds> = {
    ...empty,
    participants: [{ id: "shop", label: "Shop", kind: "system" }],
    elements: [
      { kind: "activity", id: "a", label: "A", actor: "shop" },
      { kind: "decision", id: "d", label: "D", actor: "shop" },
      ...tail.map((id) => ({
        kind: "activity" as const,
        id,
        label: id,
        actor: "shop",
      })),
    ],
    transitions: [
      { id: "t-in", source: "a", target: "d" },
      ...tail.map((id) => ({ id: `t-d-${id}`, source: "d", target: id })),
      ...tail.slice(1).map((id, index) => ({
        id: `t-${id}`,
        source: tail[index] ?? id,
        target: id,
      })),
    ],
  };

  return {
    model,
    path: ["t-in", "t-d-tail-0", ...tail.slice(1).map((id) => `t-${id}`)],
  };
};

/** One decision with `count` ways round and back to it and two ways out, and the path that goes round once and leaves. */
const manyLoops = (
  count: number,
): { readonly model: Model<OpenIds>; readonly path: string[] } => {
  const branches = ids(count, "l-");
  const model: Model<OpenIds> = {
    ...empty,
    participants: [{ id: "shop", label: "Shop", kind: "system" }],
    elements: [
      { kind: "activity", id: "a", label: "A", actor: "shop" },
      { kind: "decision", id: "d", label: "D", actor: "shop" },
      ...branches.map((id) => ({
        kind: "activity" as const,
        id,
        label: id,
        actor: "shop",
      })),
      { kind: "activity", id: "x", label: "X", actor: "shop" },
      { kind: "activity", id: "y", label: "Y", actor: "shop" },
    ],
    transitions: [
      { id: "t-in", source: "a", target: "d" },
      ...branches.flatMap((id) => [
        { id: `t-${id}`, source: "d", target: id, guard: "again" },
        { id: `t-${id}-back`, source: id, target: "d" },
      ]),
      { id: "t-x", source: "d", target: "x", guard: "done" },
      { id: "t-y", source: "d", target: "y", guard: "gave up" },
    ],
  };

  return { model, path: ["t-in", "t-l-0", "t-l-0-back", "t-x"] };
};

const sequenceReads = (
  build: (count: number) => {
    readonly model: Model<OpenIds>;
    readonly path: string[];
  },
  count: number,
  walk: boolean,
): number => {
  const { model, path } = build(count);
  const counting = countingTransitions(model);
  toSequence(counting.model, walk ? path : []);

  return counting.reads();
};

describe("toSequence's derived fragments", () => {
  it("reads each transition a fixed number of times when many branches share one tail", () => {
    expect(sequenceReads(sharedTail, 2 * size, true)).toBeLessThan(
      growthLimit * sequenceReads(sharedTail, size, true),
    );
  });

  it("reads each transition a fixed number of times for a decision with many ways round, on a path or none", () => {
    for (const walk of [true, false]) {
      expect(sequenceReads(manyLoops, 2 * size, walk)).toBeLessThan(
        growthLimit * sequenceReads(manyLoops, size, walk),
      );
    }
  });

  it("draws one loop round the decision and the alt for the way out", () => {
    const { model, path } = manyLoops(size);
    const message = (transition: string, label: string) => ({
      kind: "message" as const,
      message: { transition, from: "shop", to: "shop", label },
    });

    expect(toSequence(model, path).items).toEqual([
      {
        kind: "fragment",
        element: "d",
        operator: "loop",
        operands: [
          {
            guard: "again",
            items: [
              message("t-in", "D"),
              message("t-l-0", "l-0"),
              message("t-l-0-back", "D"),
            ],
          },
        ],
      },
      {
        kind: "fragment",
        element: "d",
        operator: "alt",
        operands: [{ guard: "done", items: [message("t-x", "X")] }],
      },
    ]);
  });
});

/** Message elements in a line between activities: `sources` activities lead into the first message, and the last message leads to `ends` activities. */
const messageRun = (
  length: number,
  sources: number,
  ends: number,
): Model<OpenIds> => {
  const run = ids(length, "m-");
  const starts = ids(sources, "s-");
  const finishes = ids(ends, "e-");

  return {
    ...empty,
    participants: [
      { id: "customer", label: "Customer", kind: "role" },
      { id: "shop", label: "Shop", kind: "system" },
      { id: "order", label: "Order", kind: "entity" },
    ],
    elements: [
      ...starts.map((id) => ({
        kind: "activity" as const,
        id,
        label: id,
        actor: "customer",
      })),
      ...run.map((id) => ({
        kind: "message" as const,
        id,
        label: id,
        from: "customer",
        to: "shop",
        mode: "async" as const,
      })),
      ...finishes.map((id) => ({
        kind: "activity" as const,
        id,
        label: id,
        actor: "shop",
      })),
    ],
    transitions: [
      ...starts.map((id) => ({ id: `t-${id}`, source: id, target: "m-0" })),
      ...run.slice(1).map((id, index) => ({
        id: `t-${id}`,
        source: run[index] ?? id,
        target: id,
      })),
      ...finishes.map((id) => ({
        id: `t-${id}`,
        source: `m-${String(length - 1)}`,
        target: id,
      })),
    ],
  };
};

/** Transition reads every chain-drawing projection makes over a model. */
const chainReads = (model: Model<OpenIds>): number => {
  const counting = countingTransitions(model);
  toFlowchart(counting.model);
  toSwimlane(counting.model);
  handoffs(counting.model);
  toStateMachine(counting.model, "order");

  return counting.reads();
};

describe("chains through runs of message elements", () => {
  it("does not copy a long run of messages once per end it fans out to", () => {
    expect(chainReads(messageRun(2 * size, 1, 2 * size))).toBeLessThan(
      growthLimit * chainReads(messageRun(size, 1, size)),
    );
  });

  it("does not walk a shared run of messages once per source leading into it", () => {
    expect(chainReads(messageRun(2 * size, 2 * size, 1))).toBeLessThan(
      growthLimit * chainReads(messageRun(size, size, 1)),
    );
  });

  it("still lists a chain's whole run when it is read", () => {
    const model = messageRun(size, 1, 1);
    const [edge] = toFlowchart(model).edges;

    expect(edge?.through).toEqual(ids(size, "m-"));
    expect(edge?.transitions).toHaveLength(size + 1);
    expect(edge?.label).toBe(ids(size, "m-").join(", "));
  });
});

/** Decisions in a line, each either doing its own step and going on to the next decision or skipping straight to the one shared end, and the path that does every step. Every decision's branches meet only at that end, so each draws an `opt` open until the path's last step. */
const nestedSkips = (
  count: number,
): { readonly model: Model<OpenIds>; readonly path: string[] } => {
  const decisions = ids(count, "d-");
  const steps = ids(count, "a-");
  const model: Model<OpenIds> = {
    ...empty,
    participants: [{ id: "shop", label: "Shop", kind: "system" }],
    elements: [
      { kind: "activity", id: "start", label: "Start", actor: "shop" },
      ...decisions.flatMap((id, index) => [
        { kind: "decision" as const, id, label: id, actor: "shop" },
        {
          kind: "activity" as const,
          id: steps[index] ?? id,
          label: steps[index] ?? id,
          actor: "shop",
        },
      ]),
      { kind: "activity", id: "end", label: "End", actor: "shop" },
    ],
    transitions: [
      { id: "t-start", source: "start", target: "d-0" },
      ...decisions.flatMap((id, index) => [
        {
          id: `t-do-${id}`,
          source: id,
          target: `a-${String(index)}`,
          guard: "do",
        },
        { id: `t-skip-${id}`, source: id, target: "end", guard: "skip" },
        {
          id: `t-on-${id}`,
          source: `a-${String(index)}`,
          target: decisions[index + 1] ?? "end",
        },
      ]),
    ],
  };

  return {
    model,
    path: [
      "t-start",
      ...decisions.flatMap((id) => [`t-do-${id}`, `t-on-${id}`]),
    ],
  };
};

const positionWork = (count: number): number => {
  const { model, path } = nestedSkips(count);
  let work = 0;
  sequenceObserved(model, path, (positions) => {
    work += positions;
  });

  return work;
};

describe("nested derived fragments", () => {
  it("never expands a span into its positions, however deeply opts nest", () => {
    expect(positionWork(2 * size)).toBeLessThanOrEqual(2 * positionWork(size));
  });

  it("nests one opt per decision, each inside the one before", () => {
    const { model, path } = nestedSkips(2);

    expect(sequenceObserved(model, path, undefined).items).toEqual([
      {
        kind: "message",
        message: {
          transition: "t-start",
          from: "shop",
          to: "shop",
          label: "d-0",
        },
      },
      {
        kind: "fragment",
        element: "d-0",
        operator: "opt",
        operands: [
          {
            guard: "do",
            items: [
              {
                kind: "message",
                message: {
                  transition: "t-do-d-0",
                  from: "shop",
                  to: "shop",
                  label: "a-0",
                },
              },
              {
                kind: "message",
                message: {
                  transition: "t-on-d-0",
                  from: "shop",
                  to: "shop",
                  label: "d-1",
                },
              },
              {
                kind: "fragment",
                element: "d-1",
                operator: "opt",
                operands: [
                  {
                    guard: "do",
                    items: [
                      {
                        kind: "message",
                        message: {
                          transition: "t-do-d-1",
                          from: "shop",
                          to: "shop",
                          label: "a-1",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "message",
        message: {
          transition: "t-on-d-1",
          from: "shop",
          to: "shop",
          label: "End",
        },
      },
    ]);
  });
});
