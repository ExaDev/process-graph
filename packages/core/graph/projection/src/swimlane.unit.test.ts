import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { toSwimlane } from "./swimlane.ts";

/** A runtime model: identifiers are plain strings, so an actor can be named without being declared. */
const open = (overrides: Partial<Model<OpenIds>>): Model<OpenIds> => ({
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [],
  transitions: [],
  fragments: [],
  projections: [],
  ...overrides,
});

describe("toSwimlane lanes", () => {
  it("has a lane for every declared actor, empty when nothing is assigned", () => {
    const lanes = toSwimlane(
      open({
        participants: [
          { id: "customer", label: "Customer", kind: "role" },
          { id: "warehouse", label: "Warehouse", kind: "system" },
          { id: "order", label: "Order", kind: "entity" },
        ],
        elements: [
          { kind: "activity", id: "a", label: "A", actor: "customer" },
        ],
      }),
    );

    expect(lanes.lanes).toEqual([
      { participant: "customer", label: "Customer", nodes: ["a"] },
      { participant: "warehouse", label: "Warehouse", nodes: [] },
    ]);
  });

  it("orders lanes by declaration, not by first appearance", () => {
    const lanes = toSwimlane(
      open({
        participants: [
          { id: "first", label: "First", kind: "role" },
          { id: "second", label: "Second", kind: "role" },
        ],
        elements: [
          { kind: "activity", id: "x", label: "X", actor: "second" },
          { kind: "activity", id: "y", label: "Y", actor: "first" },
        ],
      }),
    );

    expect(lanes.lanes.map((lane) => lane.participant)).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps a lane for an actor that was named but never declared", () => {
    const lanes = toSwimlane(
      open({
        participants: [{ id: "shop", label: "Shop", kind: "system" }],
        elements: [{ kind: "activity", id: "x", label: "X", actor: "ghost" }],
      }),
    );

    expect(lanes.lanes).toEqual([
      { participant: "shop", label: "Shop", nodes: [] },
      { participant: "ghost", label: "ghost", nodes: ["x"] },
    ]);
  });
});
