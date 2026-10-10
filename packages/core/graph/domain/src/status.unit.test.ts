import { describe, expect, it } from "vitest";
import { deriveStatuses } from "./derive.ts";
import { evaluateBranches, UnsupportedConditionError } from "./facts.ts";
import { readySet } from "./queries.ts";
import { factsOf, noFacts } from "./test-support/conditions.ts";
import {
  approval,
  branchJoin,
  chain,
  diamond,
  forkJoin,
  pipeline,
  retryLoop,
  reviewGate,
} from "./test-support/models.ts";
import { defineModel } from "@exadev/process-graph-schema";

const entries = (statuses: ReadonlyMap<string, string>) => [...statuses];

describe("status of a diamond", () => {
  it("is ready at the root and blocked behind it", () => {
    expect(entries(deriveStatuses(diamond, {}, noFacts))).toEqual([
      ["a", "ready"],
      ["b", "blocked"],
      ["c", "blocked"],
      ["d", "blocked"],
    ]);
  });

  it("opens both branches when the root is done and keeps the sink waiting", () => {
    const statuses = deriveStatuses(diamond, { a: "done" }, noFacts);

    expect(entries(statuses)).toEqual([
      ["a", "done"],
      ["b", "ready"],
      ["c", "ready"],
      ["d", "blocked"],
    ]);
  });

  it("makes the sink ready only once both branches are done", () => {
    expect(readySet(diamond, { a: "done", b: "done" }, noFacts)).toEqual(["c"]);
    expect(
      readySet(diamond, { a: "done", b: "done", c: "done" }, noFacts),
    ).toEqual(["d"]);
  });
});

describe("unknown overlay state", () => {
  it("makes the element and everything downstream unknown", () => {
    const statuses = deriveStatuses(chain, { a: "unknown" }, noFacts);

    expect(entries(statuses)).toEqual([
      ["a", "unknown"],
      ["b", "unknown"],
      ["c", "unknown"],
    ]);
  });

  it("does not disturb an element that is done itself", () => {
    const statuses = deriveStatuses(
      chain,
      { a: "unknown", b: "done" },
      noFacts,
    );

    expect(entries(statuses)).toEqual([
      ["a", "unknown"],
      ["b", "done"],
      ["c", "ready"],
    ]);
  });
});

describe("a decision's condition", () => {
  const done = { triage: "done" } as const;

  it("takes the true branch and skips the false one and what only it reaches", () => {
    const statuses = deriveStatuses(
      approval,
      done,
      factsOf({ approved: true }),
    );

    expect(entries(statuses)).toEqual([
      ["triage", "done"],
      ["choose", "done"],
      ["accept", "ready"],
      ["reject", "skipped"],
      ["notify", "blocked"],
      ["close", "blocked"],
    ]);
    expect(readySet(approval, done, factsOf({ approved: true }))).toEqual([
      "accept",
    ]);
  });

  it("takes the false branch and skips the true one and what only it reaches", () => {
    const statuses = deriveStatuses(
      approval,
      done,
      factsOf({ approved: false }),
    );

    expect(entries(statuses)).toEqual([
      ["triage", "done"],
      ["choose", "done"],
      ["accept", "skipped"],
      ["reject", "ready"],
      ["notify", "skipped"],
      ["close", "blocked"],
    ]);
    expect(readySet(approval, done, factsOf({ approved: false }))).toEqual([
      "reject",
    ]);
  });

  it("leaves both branches and everything downstream unknown when the fact is missing", () => {
    const statuses = deriveStatuses(approval, done, noFacts);

    expect(entries(statuses)).toEqual([
      ["triage", "done"],
      ["choose", "done"],
      ["accept", "unknown"],
      ["reject", "unknown"],
      ["notify", "unknown"],
      ["close", "unknown"],
    ]);
    expect(readySet(approval, done, noFacts)).toEqual([]);
  });

  it("evaluates every transition, including those of an element that is not done", () => {
    expect([
      ...evaluateBranches(approval, {}, factsOf({ approved: true })),
    ]).toEqual([
      ["t-choose", "taken"],
      ["t-accept", "taken"],
      ["t-reject", "not-taken"],
      ["t-notify", "taken"],
      ["t-close-a", "taken"],
      ["t-close-r", "taken"],
    ]);
  });
});

describe("joins", () => {
  it("waits for both branches of a fork", () => {
    const base = { a: "done" } as const;

    expect(entries(deriveStatuses(forkJoin, base, noFacts))).toEqual([
      ["a", "done"],
      ["fork", "done"],
      ["b", "ready"],
      ["c", "ready"],
      ["join", "blocked"],
      ["e", "blocked"],
    ]);
    expect(
      entries(deriveStatuses(forkJoin, { ...base, b: "done" }, noFacts)),
    ).toEqual([
      ["a", "done"],
      ["fork", "done"],
      ["b", "done"],
      ["c", "ready"],
      ["join", "blocked"],
      ["e", "blocked"],
    ]);
    expect(
      entries(
        deriveStatuses(forkJoin, { ...base, b: "done", c: "done" }, noFacts),
      ),
    ).toEqual([
      ["a", "done"],
      ["fork", "done"],
      ["b", "done"],
      ["c", "done"],
      ["join", "done"],
      ["e", "ready"],
    ]);
  });

  it("is satisfied by a branch that was skipped", () => {
    const run = { a: "done", b: "done" } as const;

    expect(
      entries(deriveStatuses(branchJoin, run, factsOf({ fast: true }))),
    ).toEqual([
      ["a", "done"],
      ["pick", "done"],
      ["b", "done"],
      ["c", "skipped"],
      ["join", "done"],
      ["e", "ready"],
    ]);
  });

  it("is not satisfied while the live branch is still open", () => {
    expect(
      entries(
        deriveStatuses(branchJoin, { a: "done" }, factsOf({ fast: true })),
      ),
    ).toEqual([
      ["a", "done"],
      ["pick", "done"],
      ["b", "ready"],
      ["c", "skipped"],
      ["join", "blocked"],
      ["e", "blocked"],
    ]);
  });
});

describe("a retry loop", () => {
  it("computes readiness on the graph without the loop edge", () => {
    expect(readySet(retryLoop, {}, noFacts)).toEqual(["write"]);
  });

  it("ignores the loop edge's own condition, even when it is indeterminate", () => {
    const statuses = deriveStatuses(
      retryLoop,
      { write: "done" },
      factsOf({ passed: true }),
    );

    expect(entries(statuses)).toEqual([
      ["write", "done"],
      ["review", "done"],
      ["publish", "ready"],
    ]);
    expect(
      entries(deriveStatuses(retryLoop, { write: "done" }, noFacts)),
    ).toEqual([
      ["write", "done"],
      ["review", "done"],
      ["publish", "unknown"],
    ]);
  });
});

describe("artefacts", () => {
  it("blocks a consumer until the input is provided", () => {
    expect(entries(deriveStatuses(pipeline, {}, noFacts))).toEqual([
      ["build", "blocked"],
      ["ship", "blocked"],
    ]);
    expect(
      entries(deriveStatuses(pipeline, {}, factsOf({}, ["spec"]))),
    ).toEqual([
      ["build", "ready"],
      ["ship", "blocked"],
    ]);
  });

  it("makes a consumer ready when its producer is done", () => {
    expect(
      entries(deriveStatuses(pipeline, { build: "done" }, noFacts)),
    ).toEqual([
      ["build", "done"],
      ["ship", "ready"],
    ]);
  });

  it("makes a consumer unknown when the producer is unknown", () => {
    expect(
      entries(deriveStatuses(pipeline, { build: "unknown" }, noFacts)),
    ).toEqual([
      ["build", "unknown"],
      ["ship", "unknown"],
    ]);
  });

  it("lets a provided artefact stand in for its unknown producer", () => {
    const statuses = deriveStatuses(
      pipeline,
      { build: "unknown" },
      factsOf({}, ["bundle"]),
    );

    expect(statuses.get("ship")).toBe("ready");
  });
});

describe("element status references", () => {
  it("reads the overlay state: done is taken, open is not, unknown is indeterminate", () => {
    const branch = (state: "done" | "open" | "unknown") =>
      evaluateBranches(reviewGate, { audit: state }, noFacts).get(
        "gate-proceed",
      );

    expect(branch("done")).toBe("taken");
    expect(branch("open")).toBe("not-taken");
    expect(branch("unknown")).toBe("indeterminate");
  });

  it("treats an element with no overlay entry as open", () => {
    expect(evaluateBranches(reviewGate, {}, noFacts).get("gate-proceed")).toBe(
      "not-taken",
    );
  });
});

describe("unsupported conditions", () => {
  it("fails loudly on a condition that needs a collection", () => {
    const model = defineModel({
      participants: [{ id: "team", label: "Team", kind: "role" }],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "activity", id: "a", label: "A", actor: "team" },
        { kind: "activity", id: "b", label: "B", actor: "team" },
      ],
      transitions: [
        {
          id: "ab",
          source: "a",
          target: "b",
          condition: {
            kind: "every",
            collection: "checks",
            item: {
              kind: "compare",
              op: "eq",
              left: { kind: "reference", key: "ok" },
              right: { kind: "booleanLiteral", value: true },
            },
          },
        },
      ],
      fragments: [],
      projections: [],
    });

    expect(() => evaluateBranches(model, {}, noFacts)).toThrow(
      UnsupportedConditionError,
    );
  });
});
