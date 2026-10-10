import { readySet } from "@exadev/process-graph-domain";
import type { Model, OpenIds, Overlay } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { queryModel } from "./conformance.ts";
import { blockedChainOf, impactOf, readyOf, structureOf } from "./structure.ts";

const noFacts = () => ({ found: false }) as const;

/** A fork into two branches that a join waits on, as a pseudo-state pair. */
const forkJoin: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    { kind: "activity", id: "design", label: "Design", actor: "team" },
    { kind: "pseudo", id: "fork", role: "fork" },
    { kind: "activity", id: "api", label: "API", actor: "team" },
    { kind: "activity", id: "ui", label: "UI", actor: "team" },
    { kind: "pseudo", id: "join", role: "join" },
    { kind: "activity", id: "release", label: "Release", actor: "team" },
  ],
  transitions: [
    { id: "s", source: "start", target: "design" },
    { id: "f", source: "design", target: "fork" },
    { id: "fa", source: "fork", target: "api" },
    { id: "fu", source: "fork", target: "ui" },
    { id: "aj", source: "api", target: "join" },
    { id: "uj", source: "ui", target: "join" },
    { id: "r", source: "join", target: "release" },
  ],
  fragments: [],
  projections: [],
};

const overlays: readonly Overlay<OpenIds>[] = [
  {},
  { a: "done" },
  { a: "done", b: "done" },
  { a: "done", b: "done", c: "done" },
  { a: "done", b: "done", c: "done", e: "done", x: "done" },
  { a: "done", x: "unknown" },
  { design: "done" },
  { design: "done", api: "done" },
  { design: "done", api: "done", ui: "done" },
];

describe("readyOf", () => {
  test.each(
    [queryModel, forkJoin].flatMap((model) =>
      overlays.map((overlay) => ({ model, overlay })),
    ),
  )(
    "agrees with graph-domain's readySet on a model without conditions or artefacts ($overlay)",
    ({ model, overlay }) => {
      expect(readyOf(structureOf(model, overlay))).toEqual(
        readySet(model, overlay, noFacts),
      );
    },
  );

  test("leaves out work whose run state is unknown, and everything waiting on it", () => {
    expect(readyOf(structureOf(queryModel, { a: "unknown" }))).toEqual(["x"]);
  });
});

describe("blockedChainOf and impactOf", () => {
  test("pass through control elements without reporting them", () => {
    const structure = structureOf(forkJoin, {});

    expect(blockedChainOf(structure, "release")).toEqual([
      { element: "api", distance: 2 },
      { element: "ui", distance: 2 },
      { element: "design", distance: 4 },
    ]);
    expect(impactOf(structure, "design")).toEqual([
      { element: "api", distance: 2 },
      { element: "ui", distance: 2 },
      { element: "release", distance: 4 },
    ]);
  });

  test("ignore a decision's loop edge, so a retry is no dependency", () => {
    const structure = structureOf(queryModel, {});

    expect(blockedChainOf(structure, "b")).toEqual([
      { element: "a", distance: 1 },
    ]);
    expect(impactOf(structure, "e").map(({ element }) => element)).toEqual([
      "f",
    ]);
  });
});
