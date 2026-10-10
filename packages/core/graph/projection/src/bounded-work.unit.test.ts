import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { sequenceObserved } from "./sequence.ts";
import { workOf } from "./test-support/work.ts";
import {
  actors,
  authoredRepeatsShape,
  combShape,
  diamondShape,
  empty,
  ids,
  serialDiamondsShape,
  sharedEndShape,
  sourcesIntoRunShape,
  wideForkShape,
  type Shape,
} from "./test-support/shapes.ts";

import {
  applyModelDiff,
  diffFlowchart,
  diffStateMachine,
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

/**
 * Every shape a review has found quadratic work in, at a size and its double, through every entry point that reads it. The work, counted by `workOf` over the collection operations the projections are built from, is measured per item of input and output: work linear in what goes in and comes out keeps that ratio level as the shape doubles, while work quadratic in either doubles it. Some outputs are themselves quadratic in their model, such as a state machine whose every state leads to every other through one folded decision; measuring against the output keeps those honest without hiding quadratic work behind a linear output. The bound sits midway, at `growthLimit` over `doubled`, because linear work with a fixed saving drifts slightly upwards. A newly found quadratic shape is a new row.
 */
const withEntity = ({
  model,
  path,
}: {
  readonly model: Model<OpenIds>;
  readonly path: readonly string[];
}): Shape => ({
  model: { ...model, participants: actors },
  path,
});

const shapes: readonly (readonly [string, (count: number) => Shape])[] = [
  ["a comb of messages", combShape],
  ["a diamond of combs", diamondShape],
  ["decisions nested to one meet", (count) => withEntity(nestedSkips(count))],
  ["many sources into one run", sourcesIntoRunShape],
  [
    "a run fanning out to many ends",
    (count) => ({
      model: { ...messageRun(count, 1, count), participants: actors },
      path: [],
    }),
  ],
  [
    "many sources into one shared run",
    (count) => ({
      model: { ...messageRun(count, count, 1), participants: actors },
      path: [],
    }),
  ],
  ["repeated steps under many authored fragments", authoredRepeatsShape],
  ["a wide fork", wideForkShape],
  ["serial diamonds of messages", serialDiamondsShape],
  ["branches sharing one tail", (count) => withEntity(sharedTail(count))],
  ["a decision with many ways round", (count) => withEntity(manyLoops(count))],
];

/** Each entry point, returning how many items its result holds, so work can be measured against what it had to produce. */
const entries: readonly (readonly [string, (shape: Shape) => number])[] = [
  [
    "toFlowchart",
    ({ model }) => {
      const flow = toFlowchart(model);

      return flow.nodes.length + flow.edges.length;
    },
  ],
  [
    "toSwimlane",
    ({ model }) => {
      const lanes = toSwimlane(model);

      return (
        lanes.nodes.length +
        lanes.edges.length +
        lanes.lanes.length +
        lanes.handoffs.length
      );
    },
  ],
  ["handoffs", ({ model }) => handoffs(model).length],
  [
    "toStateMachine",
    ({ model }) => {
      const machine = toStateMachine(model, "order");

      return machine.states.length + machine.transitions.length;
    },
  ],
  [
    "toSequence",
    ({ model, path }) => {
      const diagram = toSequence(model, path);

      return diagram.messages.length + diagram.items.length;
    },
  ],
];

/** The size of a shape as input: its elements, transitions, fragment bodies and path. */
const inputSize = ({ model, path }: Shape): number =>
  model.elements.length +
  model.transitions.length +
  model.fragments.reduce(
    (total, fragment) =>
      total +
      fragment.operands.reduce((sum, operand) => sum + operand.body.length, 0),
    0,
  ) +
  path.length;

/** Work per item of input and output for one shape through one entry point. */
const workPerItem = (shape: Shape, enter: (shape: Shape) => number): number => {
  let produced = 0;
  const work = workOf(() => {
    produced = enter(shape);
  });

  return work / (inputSize(shape) + produced);
};

/** The edit-list shapes, measured through the inverses that read them. */
const edits: readonly (readonly [string, (count: number) => () => unknown])[] =
  [
    [
      "diffFlowchart adding a ring of bars",
      (count) => {
        const bars = ids(count, "bar-");
        const edited = {
          nodes: bars.map((id) => ({
            id,
            label: "Fork",
            shape: "bar" as const,
          })),
          edges: bars.map((id, index) => ({
            from: id,
            to: bars[(index + 1) % count] ?? id,
            transitions: [`t-${id}`],
          })),
        };

        return () => diffFlowchart(empty, edited);
      },
    ],
    [
      "diffFlowchart deleting every edge of sources whose messages share one end",
      (count) => {
        const { model } = sharedEndShape(count);
        const { nodes } = toFlowchart(model);

        return () => diffFlowchart(model, { nodes, edges: [] });
      },
    ],
    [
      "diffStateMachine deleting every transition of sources whose messages share one end",
      (count) => {
        const { model } = sharedEndShape(count);
        const { states } = toStateMachine(model, "order");

        return () =>
          diffStateMachine(model, {
            subject: "order",
            states,
            transitions: [],
          });
      },
    ],
    [
      "applyModelDiff renaming every activity",
      (count) => {
        const activities = ids(count, "a-");
        const model: Model<OpenIds> = {
          ...empty,
          elements: activities.map((id) => ({
            kind: "activity",
            id,
            label: id,
          })),
        };
        const diff: ModelDiff<OpenIds> = {
          elements: activities.map((id) => ({
            kind: "renamed",
            element: id,
            from: id,
            to: `${id}!`,
            inferred: false,
          })),
          transitions: [],
          events: [],
        };

        return () => applyModelDiff(model, diff);
      },
    ],
  ];

const doubled = 2;

describe("work at most doubles when a reported shape doubles", () => {
  describe.each(shapes)("%s", (_shape, build) => {
    const small = build(size);
    const large = build(doubled * size);

    it.each(entries)("through %s", (_entry, enter) => {
      expect(workPerItem(large, enter)).toBeLessThan(
        (growthLimit / doubled) * workPerItem(small, enter),
      );
    });
  });

  it.each(edits)("%s", (_edit, prepare) => {
    const small = prepare(size);
    const large = prepare(doubled * size);

    expect(workOf(large)).toBeLessThan(growthLimit * workOf(small));
  });
});
