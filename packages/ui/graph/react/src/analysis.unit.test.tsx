import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  useBlockedChain,
  useCriticalPath,
  useImpact,
  useReadySet,
  useStatuses,
  useWhyStatus,
} from "./analysis.ts";
import { noFacts } from "./run.ts";
import type { Overlay } from "@exadev/process-graph-schema";
import type { OrderIds } from "./test-support/ids.ts";
import { order } from "./test-support/order.ts";

/** The order process with the customer's submission done: requesting payment can start, and everything after it waits. */
const submitted = {
  model: order,
  overlay: { "a-submit": "done" },
  facts: noFacts,
} as const;

describe("reasoning hooks", () => {
  test("useStatuses derives every element's status from the overlay", () => {
    const { result } = renderHook(() => useStatuses(submitted));

    expect(Object.fromEntries(result.current)).toEqual({
      start: "done",
      "a-submit": "done",
      "a-request": "ready",
      "a-authorise": "blocked",
      "d-authorised": "blocked",
      "a-pack": "blocked",
      "a-cancel": "blocked",
      end: "blocked",
    });
  });

  test("useReadySet is the work that can start now", () => {
    const { result } = renderHook(() => useReadySet(submitted));

    expect(result.current).toEqual(["a-request"]);
  });

  test("useBlockedChain follows unfinished needs to the blocker at the end", () => {
    const { result } = renderHook(() => useBlockedChain(submitted, "a-pack"));

    expect(result.current.blockers).toEqual(["a-request"]);
    expect(result.current.chain.map((link) => link.element)).toEqual([
      "a-pack",
      "a-request",
      "a-authorise",
      "d-authorised",
    ]);
  });

  test("useBlockedChain is empty when nothing is asked about", () => {
    const { result } = renderHook(() => useBlockedChain(submitted, undefined));

    expect(result.current).toEqual({ chain: [], blockers: [] });
  });

  test("useWhyStatus names the rule that decided the status", () => {
    const { result } = renderHook(() => useWhyStatus(submitted, "a-authorise"));

    expect(result.current?.status).toBe("blocked");
    expect(result.current?.rule).toBe("waiting");
  });

  test("useImpact is the live work downstream of an element", () => {
    const { result } = renderHook(() => useImpact(submitted, "a-request"));

    expect(result.current).toEqual([
      "a-authorise",
      "d-authorised",
      "a-pack",
      "a-cancel",
      "end",
    ]);
  });

  test("useCriticalPath counts each element as one step by default", () => {
    const { result } = renderHook(() => useCriticalPath(submitted));

    expect(result.current.path).toEqual([
      "a-request",
      "a-authorise",
      "d-authorised",
      "a-pack",
      "end",
    ]);
    expect(result.current.weight).toBe(result.current.path.length);
  });

  test("the hooks recompute when the overlay changes", () => {
    const initial: Overlay<OrderIds> = submitted.overlay;
    const { result, rerender } = renderHook(
      ({ overlay }) => useReadySet({ model: order, overlay, facts: noFacts }),
      { initialProps: { overlay: initial } },
    );
    rerender({ overlay: { "a-submit": "done", "a-request": "done" } });

    expect(result.current).toEqual(["a-authorise"]);
  });
});
