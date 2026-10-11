import { defineModel } from "@exadev/process-graph-schema";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { noFacts, StatusBadge, useReadySet } from "../dist/index.js";

afterEach(cleanup);

const model = defineModel({
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "first", label: "First" },
    { kind: "activity", id: "second", label: "Second" },
  ],
  transitions: [{ id: "t1", source: "first", target: "second" }],
  fragments: [],
  projections: [],
});

test("the built package derives the ready set", () => {
  const { result } = renderHook(() =>
    useReadySet({ model, overlay: { first: "done" }, facts: noFacts }),
  );

  expect(result.current).toEqual(["second"]);
});

test("the built package renders a status badge", () => {
  render(<StatusBadge status="blocked" />);

  expect(screen.getByText("Blocked").getAttribute("data-status")).toBe(
    "blocked",
  );
});
