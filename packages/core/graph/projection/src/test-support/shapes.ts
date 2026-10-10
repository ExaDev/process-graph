import type { Model, OpenIds } from "@exadev/process-graph-schema";

/**
 * Shapes a review found quadratic work in, each built at a given size, for the scaling table in `bounded-work.unit.test.ts`.
 */

/** Numbered identifiers with a prefix. */
export const ids = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index)}`);

/** A model with nothing in it, to build shapes from. */
export const empty: Model<OpenIds> = {
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [],
  transitions: [],
  fragments: [],
  projections: [],
};

/** The participants every shape uses: a customer, a shop, and the order a state machine follows. */
export const actors = [
  { id: "customer", label: "Customer", kind: "role" as const },
  { id: "shop", label: "Shop", kind: "system" as const },
  { id: "order", label: "Order", kind: "entity" as const },
];

const activity = (id: string, actor = "shop") => ({
  kind: "activity" as const,
  id,
  label: id,
  actor,
});
const messageElement = (id: string) => ({
  kind: "message" as const,
  id,
  label: id,
  from: "customer",
  to: "shop",
  mode: "async" as const,
});

/** A model and a path through it. */
export interface Shape {
  readonly model: Model<OpenIds>;
  readonly path: readonly string[];
}

/** Messages in a line, each with its own exit, entered from one activity. */
export const combShape = (count: number): Shape => {
  const teeth = ids(count, "m-");

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        activity("s", "customer"),
        ...teeth.map(messageElement),
        ...teeth.map((id) => activity(`e-${id}`)),
      ],
      transitions: [
        { id: "t-in", source: "s", target: "m-0" },
        ...teeth.flatMap((id, index) => [
          { id: `t-${id}-out`, source: id, target: `e-${id}` },
          {
            id: `t-${id}-on`,
            source: id,
            target: teeth[index + 1] ?? `e-${id}`,
          },
        ]),
      ],
    },
    path: ["t-in", ...teeth.map((id) => `t-${id}-on`)],
  };
};

/** Two combs from one message, joined at a last message, exiting to shared activities. */
export const diamondShape = (count: number): Shape => {
  const shared = ids(count, "e-");
  const arm = (side: string): string[] =>
    shared.map((_, index) => `${side}-${String(index)}`);
  const left = arm("l");
  const right = arm("r");
  const teeth = (side: readonly string[]) =>
    side.flatMap((id, index) => [
      { id: `t-${id}-out`, source: id, target: shared[index] ?? id },
      { id: `t-${id}-on`, source: id, target: side[index + 1] ?? "join" },
    ]);

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        activity("s", "customer"),
        ...["fork", ...left, ...right, "join"].map(messageElement),
        ...shared.map((id) => activity(id)),
        activity("last"),
      ],
      transitions: [
        { id: "t-in", source: "s", target: "fork" },
        { id: "t-left", source: "fork", target: left[0] ?? "join" },
        { id: "t-right", source: "fork", target: right[0] ?? "join" },
        ...teeth(left),
        ...teeth(right),
        { id: "t-last", source: "join", target: "last" },
      ],
    },
    path: ["t-in", "t-left", ...left.map((id) => `t-${id}-on`), "t-last"],
  };
};

/** Activities each entering their own message of one run, every message also leaving for the same end. */
export const sourcesIntoRunShape = (count: number): Shape => {
  const run = ids(count, "m-");

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        ...run.map((id) => activity(`s-${id}`, "customer")),
        ...run.map(messageElement),
        activity("end"),
      ],
      transitions: run.flatMap((id, index) => [
        { id: `t-s-${id}`, source: `s-${id}`, target: id },
        { id: `t-${id}-on`, source: id, target: run[index + 1] ?? "end" },
        { id: `t-${id}-end`, source: id, target: "end" },
      ]),
    },
    path: ["t-s-m-0", ...run.map((id) => `t-${id}-on`)],
  };
};

/** One activity stepping round to itself, with that many authored fragments over it. */
export const authoredRepeatsShape = (count: number): Shape => ({
  model: {
    ...empty,
    participants: actors,
    elements: [activity("x")],
    transitions: [{ id: "t-loop", source: "x", target: "x" }],
    fragments: ids(count, "f-").map((id) => ({
      id,
      operator: "opt" as const,
      operands: [{ body: ["x"] }],
    })),
  },
  path: Array.from({ length: count }, () => "t-loop"),
});

/** A fork into that many branches, each one step, joined again, with the path taking every branch. */
export const wideForkShape = (count: number): Shape => {
  const branches = ids(count, "b-");

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        activity("start"),
        { kind: "pseudo", id: "fork", role: "fork" },
        ...branches.map((id) => activity(id)),
        { kind: "pseudo", id: "join", role: "join" },
        activity("end"),
      ],
      transitions: [
        { id: "t-start", source: "start", target: "fork" },
        ...branches.flatMap((id) => [
          { id: `t-to-${id}`, source: "fork", target: id },
          { id: `t-from-${id}`, source: id, target: "join" },
        ]),
        { id: "t-end", source: "join", target: "end" },
      ],
    },
    path: [
      "t-start",
      ...branches.flatMap((id) => [`t-to-${id}`, `t-from-${id}`]),
      "t-end",
    ],
  };
};

/** Diamonds of messages in a line, each splitting into two messages that meet again, with each meeting point also leaving for its own activity. */
export const serialDiamondsShape = (count: number): Shape => {
  const diamonds = ids(count, "d");
  const top = (index: number): string => `top-${String(index)}`;
  const bottom = (index: number): string => `bottom-${String(index)}`;

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        activity("s", "customer"),
        ...diamonds.flatMap((id, index) =>
          [top(index), `${id}-a`, `${id}-b`, bottom(index)].map(messageElement),
        ),
        ...diamonds.map((id) => activity(`e-${id}`)),
        activity("end"),
      ],
      transitions: [
        { id: "t-in", source: "s", target: top(0) },
        ...diamonds.flatMap((id, index) => [
          { id: `t-${id}-a`, source: top(index), target: `${id}-a` },
          { id: `t-${id}-b`, source: top(index), target: `${id}-b` },
          { id: `t-${id}-a-meet`, source: `${id}-a`, target: bottom(index) },
          { id: `t-${id}-b-meet`, source: `${id}-b`, target: bottom(index) },
          { id: `t-${id}-out`, source: bottom(index), target: `e-${id}` },
          {
            id: `t-${id}-on`,
            source: bottom(index),
            target: index + 1 < count ? top(index + 1) : "end",
          },
        ]),
      ],
    },
    path: [
      "t-in",
      ...diamonds.flatMap((id) => [
        `t-${id}-a`,
        `t-${id}-a-meet`,
        `t-${id}-on`,
      ]),
    ],
  };
};

/** Sources each entering their own message, every message leaving for one shared end. */
export const sharedEndShape = (count: number): Shape => {
  const sources = ids(count, "s-");

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        ...sources.map((id) => activity(id, "customer")),
        ...sources.map((id) => messageElement(`m-${id}`)),
        activity("end"),
      ],
      transitions: sources.flatMap((id) => [
        { id: `t-${id}`, source: id, target: `m-${id}` },
        { id: `t-m-${id}`, source: `m-${id}`, target: "end" },
      ]),
    },
    path: [],
  };
};

/** Activities in a line, one authored fragment over all of them, and one authored fragment over each of them nested inside it. */
export const authoredNestingShape = (count: number): Shape => {
  const steps = ids(count, "x-");

  return {
    model: {
      ...empty,
      participants: actors,
      elements: steps.map((id) => activity(id)),
      transitions: steps.slice(1).map((id, index) => ({
        id: `t-${id}`,
        source: steps[index] ?? id,
        target: id,
      })),
      fragments: [
        { id: "outer", operator: "opt", operands: [{ body: steps }] },
        ...steps.map((id) => ({
          id: `f-${id}`,
          operator: "opt" as const,
          operands: [{ body: [id] }],
        })),
      ],
    },
    path: steps.slice(1).map((id) => `t-${id}`),
  };
};

/** One message splitting into two messages that both lead to every one of many activities, so every edge into those activities is a merged chain over the same branches. */
export const twoBranchesShape = (count: number): Shape => {
  const ends = ids(count, "e-");

  return {
    model: {
      ...empty,
      participants: actors,
      elements: [
        activity("s", "customer"),
        ...["split", "left", "right"].map(messageElement),
        ...ends.map((id) => activity(id)),
      ],
      transitions: [
        { id: "t-in", source: "s", target: "split" },
        { id: "t-left", source: "split", target: "left" },
        { id: "t-right", source: "split", target: "right" },
        ...ends.flatMap((id) => [
          { id: `t-left-${id}`, source: "left", target: id },
          { id: `t-right-${id}`, source: "right", target: id },
        ]),
      ],
    },
    path: [],
  };
};
