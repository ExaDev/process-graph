import { CycleError } from "@exadev/process-graph-dag";
import { describe, expect, it } from "vitest";
import { controlDag, illegalCycles, loopTransitions } from "./control.ts";
import { deriveStatuses } from "./derive.ts";
import { noFacts } from "./test-support/conditions.ts";
import {
  approval,
  chain,
  diamond,
  pipeline,
  plainCycle,
  retryLoop,
} from "./test-support/models.ts";

describe("controlDag", () => {
  it("needs the sources of the incoming transitions", () => {
    const dag = controlDag(diamond);

    expect(dag.nodes).toEqual(["a", "b", "c", "d"]);
    expect(dag.needs.get("d")).toEqual(["b", "c"]);
    expect(dag.needs.get("a")).toEqual([]);
  });

  it("adds the producer of every consumed artefact to an activity's needs", () => {
    expect(controlDag(pipeline).needs.get("ship")).toEqual(["build"]);
    expect(controlDag(pipeline).needs.get("build")).toEqual([]);
  });

  it("leaves the loop edge of a decision out of the needs", () => {
    expect(controlDag(retryLoop).needs.get("write")).toEqual([]);
    expect(controlDag(retryLoop).needs.get("publish")).toEqual(["review"]);
  });
});

describe("loopTransitions", () => {
  it("names the decision transition that closes a cycle and no other", () => {
    expect(loopTransitions(retryLoop)).toEqual(["retry"]);
  });

  it("does not take a decision's forward branches for loops", () => {
    expect(loopTransitions(approval)).toEqual([]);
  });

  it("does not take a cycle without a decision for a loop", () => {
    expect(loopTransitions(plainCycle)).toEqual([]);
  });
});

describe("illegalCycles", () => {
  it("reports a plain cycle with its path", () => {
    expect(illegalCycles(plainCycle)).toEqual([["x", "y", "x"]]);
  });

  it("accepts a retry loop through a decision", () => {
    expect(illegalCycles(retryLoop)).toEqual([]);
  });

  it("finds none in an acyclic model", () => {
    expect(illegalCycles(chain)).toEqual([]);
  });

  it("makes the derivation throw an error carrying the cycle", () => {
    try {
      deriveStatuses(plainCycle, {}, noFacts);
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect(error instanceof CycleError ? error.cycles : []).toEqual([
        ["x", "y", "x"],
      ]);

      return;
    }

    throw new Error("expected deriveStatuses to throw");
  });
});
