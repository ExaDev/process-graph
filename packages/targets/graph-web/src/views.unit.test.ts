import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { resolveView, transitionsAlong } from "./views.ts";

const model: Model<OpenIds> = {
  participants: [
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    {
      kind: "activity",
      id: "a",
      label: "A",
      actor: "shop",
      affects: ["order"],
    },
    {
      kind: "activity",
      id: "b",
      label: "B",
      actor: "shop",
      affects: ["order"],
    },
    { kind: "activity", id: "c", label: "C", actor: "shop" },
  ],
  transitions: [
    { id: "a->b", source: "a", target: "b" },
    { id: "b->c", source: "b", target: "c" },
  ],
  fragments: [],
  projections: [],
};

const noEntities: Model<OpenIds> = {
  ...model,
  participants: [{ id: "shop", label: "Shop", kind: "system" }],
  elements: model.elements.map((element) =>
    element.kind === "activity" ? { ...element, affects: [] } : element,
  ),
};

const inputs = {
  subject: undefined,
  scenario: [],
  criticalPath: ["a", "b", "c"],
} as const;

describe("resolveView", () => {
  test("draws a flowchart and a swimlane with nothing more", () => {
    expect(resolveView(model, { ...inputs, view: "flowchart" })).toEqual({
      projection: { id: "flowchart", notation: "flowchart" },
    });
    expect(resolveView(model, { ...inputs, view: "swimlane" })).toEqual({
      projection: { id: "swimlane", notation: "swimlane" },
    });
  });

  test("follows the model's first entity in a state machine, or the one the link names", () => {
    expect(resolveView(model, { ...inputs, view: "state" })).toEqual({
      projection: { id: "state", notation: "stateMachine", subject: "order" },
    });
    expect(
      resolveView(model, { ...inputs, view: "state", subject: "shop" }),
    ).toEqual({
      unavailable:
        '"shop" is not an entity of this model, so it has no states to follow.',
    });
  });

  test("says why a model with no entity has no state machine", () => {
    expect(resolveView(noEntities, { ...inputs, view: "state" })).toEqual({
      unavailable:
        "A state machine follows one entity through its states, and this model declares no entity. Issues from a source are work, not entities; add an entity to follow one.",
    });
  });

  test("follows the critical path in a sequence diagram unless the link names a scenario", () => {
    expect(resolveView(model, { ...inputs, view: "sequence" })).toEqual({
      projection: {
        id: "sequence",
        notation: "sequence",
        scenario: ["a->b", "b->c"],
      },
    });
    expect(
      resolveView(model, { ...inputs, view: "sequence", scenario: ["b->c"] }),
    ).toEqual({
      projection: { id: "sequence", notation: "sequence", scenario: ["b->c"] },
    });
    expect(
      resolveView(model, { ...inputs, view: "sequence", scenario: ["c->a"] }),
    ).toEqual({
      unavailable:
        '"c->a" is not a transition of this model, so the sequence cannot follow it.',
    });
  });

  test("prefers the model's own projections to the defaults", () => {
    const declared: Model<OpenIds> = {
      ...model,
      projections: [{ id: "path", notation: "sequence", scenario: ["a->b"] }],
    };

    expect(resolveView(declared, { ...inputs, view: "sequence" })).toEqual({
      projection: { id: "sequence", notation: "sequence", scenario: ["a->b"] },
    });
  });

  test("says when there is no path to follow", () => {
    expect(
      resolveView(model, { ...inputs, view: "sequence", criticalPath: ["c"] }),
    ).toEqual({
      unavailable:
        "A sequence diagram follows one path of transitions, and there is none to follow: no work is waiting on other work.",
    });
  });
});

describe("transitionsAlong", () => {
  test("reads a path as the transitions between its consecutive elements", () => {
    expect(transitionsAlong(model, ["a", "b", "c"])).toEqual(["a->b", "b->c"]);
    expect(transitionsAlong(model, ["a"])).toEqual([]);
  });
});
