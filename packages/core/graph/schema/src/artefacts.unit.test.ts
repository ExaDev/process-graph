import { describe, expect, it } from "vitest";
import { inputsOf, outputsOf } from "./artefacts.ts";
import { defineModel } from "./model.ts";

/** Brief, spec, code and release, each produced by a different step or by none. */
const delivery = defineModel({
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [
    { id: "brief", name: "Brief" },
    { id: "spec", name: "Specification" },
    { id: "code", name: "Code" },
    { id: "release", name: "Release", deliverable: true },
    { id: "notes", name: "Notes", deliverable: false },
  ],
  elements: [
    {
      kind: "activity",
      id: "write-spec",
      label: "Write specification",
      actor: "team",
      consumes: ["brief"],
      produces: ["spec"],
    },
    {
      kind: "activity",
      id: "build",
      label: "Build",
      actor: "team",
      consumes: ["spec"],
      produces: ["code"],
    },
    {
      kind: "activity",
      id: "ship",
      label: "Ship",
      actor: "team",
      consumes: ["code"],
      produces: ["release"],
    },
  ],
  transitions: [],
  fragments: [],
  projections: [],
});

describe("inputsOf", () => {
  it("returns the artefacts no activity produces, in declaration order", () => {
    expect(inputsOf(delivery).map((artefact) => artefact.id)).toEqual([
      "brief",
      "notes",
    ]);
  });

  it("returns every artefact when no activity produces any", () => {
    const bare = defineModel({
      participants: [],
      events: [],
      actions: [],
      artefacts: [{ id: "a", name: "A" }],
      elements: [{ kind: "activity", id: "x", label: "X", consumes: ["a"] }],
      transitions: [],
      fragments: [],
      projections: [],
    });

    expect(inputsOf(bare)).toEqual([{ id: "a", name: "A" }]);
  });
});

describe("outputsOf", () => {
  it("returns only the artefacts flagged deliverable", () => {
    expect(outputsOf(delivery)).toEqual([
      { id: "release", name: "Release", deliverable: true },
    ]);
  });

  it("returns nothing when no artefact is flagged", () => {
    expect(outputsOf({ ...delivery, artefacts: [] })).toEqual([]);
  });
});
