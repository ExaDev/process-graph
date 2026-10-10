import { describe, expect, it } from "vitest";
import {
  blockedBy,
  criticalPath,
  impact,
  unmetOutputs,
  whatIfDone,
} from "./queries.ts";
import { factsOf, noFacts } from "./test-support/conditions.ts";
import { approval, chain, diamond, pipeline } from "./test-support/models.ts";

describe("blockedBy", () => {
  it("is the first open element of a chain", () => {
    expect(blockedBy(chain, {}, noFacts, "c")).toEqual(["a"]);
    expect(blockedBy(chain, { a: "done" }, noFacts, "c")).toEqual(["b"]);
  });

  it("is every open leaf behind a join", () => {
    expect(blockedBy(diamond, { a: "done" }, noFacts, "d")).toEqual(["b", "c"]);
    expect(blockedBy(diamond, {}, noFacts, "d")).toEqual(["a"]);
  });

  it("is empty for an element that is ready or done", () => {
    expect(blockedBy(chain, {}, noFacts, "a")).toEqual([]);
    expect(blockedBy(chain, { a: "done" }, noFacts, "a")).toEqual([]);
  });

  it("names an element whose state is unknown as the leaf", () => {
    expect(blockedBy(chain, { a: "unknown" }, noFacts, "c")).toEqual(["a"]);
  });

  it("does not follow a branch that was not taken", () => {
    expect(
      blockedBy(
        approval,
        { triage: "done" },
        factsOf({ approved: false }),
        "close",
      ),
    ).toEqual(["reject"]);
  });
});

describe("impact", () => {
  it("is every transitive dependent of an open element", () => {
    expect(impact(chain, {}, noFacts, "a")).toEqual(["b", "c"]);
  });

  it("leaves out dependents on branches that are not taken", () => {
    expect(impact(approval, {}, factsOf({ approved: true }), "triage")).toEqual(
      ["choose", "accept", "notify", "close"],
    );
  });

  it("does not pass through work that is already done", () => {
    expect(impact(chain, { b: "done" }, noFacts, "a")).toEqual([]);
  });
});

describe("whatIfDone", () => {
  it("reports what a chain's head unblocks", () => {
    expect(whatIfDone(chain, {}, noFacts, "a")).toEqual({
      becomesReady: ["b"],
      changes: [
        { id: "a", before: "ready", after: "done" },
        { id: "b", before: "blocked", after: "ready" },
      ],
    });
  });

  it("reports nothing for an element that is already done", () => {
    expect(whatIfDone(chain, { a: "done" }, noFacts, "a")).toEqual({
      becomesReady: [],
      changes: [],
    });
  });

  it("reports a skip that finishing a decision's input would not change", () => {
    const result = whatIfDone(
      approval,
      {},
      factsOf({ approved: false }),
      "triage",
    );

    expect(result.becomesReady).toEqual(["reject"]);
    expect(result.changes).toEqual([
      { id: "triage", before: "ready", after: "done" },
      { id: "choose", before: "blocked", after: "done" },
      { id: "reject", before: "blocked", after: "ready" },
    ]);
  });
});

describe("criticalPath", () => {
  const weights: Readonly<Record<string, number>> = { a: 1, b: 5, c: 2, d: 1 };
  const weight = (id: string): number => weights[id] ?? 0;

  it("follows the heaviest live chain", () => {
    expect(criticalPath(diamond, {}, noFacts, weight)).toEqual({
      path: ["a", "b", "d"],
      weight: 7,
    });
  });

  it("drops finished work from the path and the weight", () => {
    expect(criticalPath(diamond, { a: "done" }, noFacts, weight)).toEqual({
      path: ["b", "d"],
      weight: 6,
    });
  });

  it("leaves a skipped branch out even when it is the heaviest", () => {
    const outweighsAll = 100;
    const heavy = (id: string): number => (id === "reject" ? outweighsAll : 1);

    expect(
      criticalPath(
        approval,
        { triage: "done" },
        factsOf({ approved: true }),
        heavy,
      ),
    ).toEqual({ path: ["accept", "notify", "close"], weight: 3 });
  });

  it("is empty when nothing is left to do", () => {
    expect(
      criticalPath(chain, { a: "done", b: "done", c: "done" }, noFacts, weight),
    ).toEqual({ path: [], weight: 0 });
  });
});

describe("unmetOutputs", () => {
  it("shows a deliverable reachable only through an input nobody provided", () => {
    expect(unmetOutputs(pipeline, {}, noFacts)).toEqual([
      {
        artefact: "release",
        producers: ["ship"],
        needed: ["build", "ship"],
        missingInputs: ["spec"],
      },
    ]);
  });

  it("drops the missing input once it is provided", () => {
    expect(unmetOutputs(pipeline, {}, factsOf({}, ["spec"]))).toEqual([
      {
        artefact: "release",
        producers: ["ship"],
        needed: ["build", "ship"],
        missingInputs: [],
      },
    ]);
  });

  it("narrows to what is still open as work finishes", () => {
    expect(
      unmetOutputs(pipeline, { build: "done" }, noFacts).map(
        ({ needed }) => needed,
      ),
    ).toEqual([["ship"]]);
  });

  it("reports nothing once the deliverable's producer is done", () => {
    expect(
      unmetOutputs(pipeline, { build: "done", ship: "done" }, noFacts),
    ).toEqual([]);
  });
});
