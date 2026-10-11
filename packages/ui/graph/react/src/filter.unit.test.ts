import { describe, expect, test } from "vitest";
import { defineModel } from "@exadev/process-graph-schema";
import {
  emptyFilter,
  filterElements,
  filterOptions,
  matchesFilter,
  sourceScope,
} from "./filter.ts";

/** Two repositories' issues, one with an owner and one without. */
const bound = defineModel({
  participants: [{ id: "dev", label: "Developer", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    {
      kind: "activity",
      id: "github:org/app#1",
      label: "Build",
      actor: "dev",
      source: "github:org/app#1",
    },
    {
      kind: "activity",
      id: "github:org/lib#7",
      label: "Release",
      source: "github:org/lib#7",
    },
    { kind: "activity", id: "local", label: "Review" },
  ],
  transitions: [],
  fragments: [],
  projections: [],
});

const ready = new Map(
  bound.elements.map((element) => [element.id, "ready" as const]),
);

describe("sourceScope", () => {
  test("is the identifier up to its item number", () => {
    expect(sourceScope("github:org/app#1")).toBe("github:org/app");
  });

  test("is the whole identifier when it has no item number", () => {
    expect(sourceScope("jira:PROJ")).toBe("jira:PROJ");
  });
});

describe("filtering", () => {
  test("the empty filter shows every element", () => {
    expect(filterElements(bound, ready, emptyFilter)).toEqual(
      bound.elements.map((element) => element.id),
    );
  });

  test("a source filter shows the work of that source only", () => {
    expect(
      filterElements(bound, ready, {
        ...emptyFilter,
        sources: new Set(["github:org/lib"]),
      }),
    ).toEqual(["github:org/lib#7"]);
  });

  test("an actor filter leaves out elements with no actor", () => {
    expect(
      filterElements(bound, ready, {
        ...emptyFilter,
        actors: new Set(["dev"]),
      }),
    ).toEqual(["github:org/app#1"]);
  });

  test("a message matches either of its ends", () => {
    const message = {
      kind: "message",
      id: "m",
      label: "Notify",
      from: "dev",
      to: "ops",
      mode: "async",
    } as const;

    expect(
      matchesFilter(message, "ready", {
        ...emptyFilter,
        actors: new Set(["ops"]),
      }),
    ).toBe(true);
  });

  test("options list the acting participants and the source collections", () => {
    expect(filterOptions(bound)).toEqual({
      actors: [{ value: "dev", label: "Developer" }],
      sources: [
        { value: "github:org/app", label: "github:org/app" },
        { value: "github:org/lib", label: "github:org/lib" },
      ],
    });
  });
});
