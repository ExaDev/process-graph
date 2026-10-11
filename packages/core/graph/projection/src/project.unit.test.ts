import { describe, expect, test } from "vitest";
import { toFlowchart } from "./flowchart.ts";
import { project } from "./project.ts";
import { toSequence } from "./sequence.ts";
import { toStateMachine } from "./state-machine.ts";
import { toSwimlane } from "./swimlane.ts";
import { order } from "./test-support/order.ts";

describe("project", () => {
  test("projects each declared projection into its notation, following its subject or scenario", () => {
    const [, , state, sequence] = order.projections;

    expect(
      order.projections.map(
        (projection) => project(order, projection).notation,
      ),
    ).toEqual(["flowchart", "swimlane", "stateMachine", "sequence"]);
    expect(state === undefined ? undefined : project(order, state)).toEqual({
      notation: "stateMachine",
      view: toStateMachine(order, "order"),
    });
    expect(
      sequence === undefined ? undefined : project(order, sequence),
    ).toEqual({
      notation: "sequence",
      view: toSequence(order, ["t1", "t2", "t3", "t4", "t5", "t7"]),
    });
  });

  test("tells a flowchart from a swimlane, which record nothing else", () => {
    expect(project(order, { id: "f", notation: "flowchart" })).toEqual({
      notation: "flowchart",
      view: toFlowchart(order),
    });
    expect(project(order, { id: "s", notation: "swimlane" })).toEqual({
      notation: "swimlane",
      view: toSwimlane(order),
    });
  });
});
