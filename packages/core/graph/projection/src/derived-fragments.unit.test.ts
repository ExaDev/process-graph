import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { deriveFragments } from "./derived-fragments.ts";

/** Enough loop branches that a walk per branch, or per loop element, costs far more than one pass over the graph. */
const loopBranches = 300;

const branches = Array.from(
  { length: loopBranches },
  (_, index) => `l-${String(index)}`,
);

/** One decision with many ways round and back to it, and two ways out. */
const retrying: Model<OpenIds> = {
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A" },
    { kind: "decision", id: "d", label: "D" },
    ...branches.map((id) => ({ kind: "activity" as const, id, label: id })),
    { kind: "activity", id: "x", label: "X" },
    { kind: "activity", id: "y", label: "Y" },
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
  fragments: [],
  projections: [],
};

const everything = new Set(retrying.elements.map((element) => element.id));

describe("deriveFragments on a decision with many loop branches", () => {
  it("derives one loop over the decision's whole cycle and one alt for its ways out", () => {
    const [loop, alt, ...rest] = deriveFragments(retrying, everything);

    expect(rest).toEqual([]);
    expect(loop?.element).toBe("d");
    expect(loop?.operator).toBe("loop");
    expect(loop?.operands.map((operand) => operand.guard)).toEqual(["again"]);
    expect(new Set(loop?.operands[0]?.body)).toEqual(
      new Set(["d", ...branches]),
    );
    expect(alt).toEqual({
      element: "d",
      operator: "alt",
      operands: [
        { guard: "done", body: ["x"] },
        { guard: "gave up", body: ["y"] },
      ],
    });
  });

  it("expands no more elements than the graph has elements and transitions", () => {
    let expanded = 0;
    deriveFragments(retrying, everything, () => {
      expanded += 1;
    });

    expect(expanded).toBeLessThanOrEqual(
      retrying.elements.length + retrying.transitions.length,
    );
  });

  it("does no walks for a scenario that passes no decision or fork", () => {
    let expanded = 0;
    const derived = deriveFragments(retrying, new Set(), () => {
      expanded += 1;
    });

    expect(derived).toEqual([]);
    expect(expanded).toBe(0);
  });
});
