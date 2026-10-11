import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useProjection } from "./projection.ts";
import { order } from "./test-support/order.ts";

describe("useProjection", () => {
  test("projects each of the model's declared projections into its notation", () => {
    const notations = order.projections.map((projection) => {
      const { result } = renderHook(() => useProjection(order, projection));

      return result.current.notation;
    });

    expect(notations).toEqual(order.projections.map((p) => p.notation));
  });

  test("a swimlane carries its lanes and hand-offs", () => {
    const { result } = renderHook(() =>
      useProjection(order, { id: "lanes", notation: "swimlane" }),
    );
    if (result.current.notation !== "swimlane") {
      throw new Error("expected a swimlane");
    }

    expect(result.current.view.lanes.map((lane) => lane.label)).toEqual([
      "Customer",
      "Shop",
      "Payment provider",
    ]);
    expect(
      result.current.view.handoffs.map((handoff) => handoff.transition),
    ).toEqual(["t2", "t3", "t4"]);
  });

  test("a sequence follows the projection's scenario", () => {
    const { result } = renderHook(() =>
      useProjection(order, {
        id: "seq",
        notation: "sequence",
        scenario: ["t2", "t3"],
      }),
    );
    if (result.current.notation !== "sequence") {
      throw new Error("expected a sequence diagram");
    }

    expect(result.current.view.lifelines).toEqual([
      "customer",
      "shop",
      "provider",
    ]);
  });

  test("keeps the same view while its inputs are unchanged", () => {
    const projection = { id: "flow", notation: "flowchart" } as const;
    const { result, rerender } = renderHook(() =>
      useProjection(order, projection),
    );
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
