import {
  syncPageSchema,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import {
  boundItemsSchema,
  type BoundItems,
} from "@exadev/process-graph-store-contract";
import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import { pageOf } from "./test-support/fixtures.ts";

/** The activity schema of a source's sync page. */
const pageActivitySchema = syncPageSchema
  .unwrap()
  .shape.activities.unwrap().element;

/** The activity schema of a store's upserted items. */
const itemsActivitySchema = boundItemsSchema
  .unwrap()
  .shape.activities.unwrap().element;

/** An activity carrying every field the model gives an activity. */
const everyField = {
  kind: "activity",
  id: "github:o/r#1",
  source: "github:o/r#1",
  label: "One",
  actor: "github:o/r",
  action: "review",
  extensions: { swimlane: { lane: 2, note: ["a", null, true] } },
  affects: ["order"],
  consumes: ["spec"],
  produces: ["build"],
};

const emptyPage = {
  participants: [],
  transitions: [],
  relations: [],
  overlay: {},
  gaps: [],
};

const emptyItems = {
  participants: [],
  transitions: [],
  overlay: {},
};

describe("a sync page's activities and a store's upserted activities", () => {
  test("have the same inferred type", () => {
    expectTypeOf<SyncPage["activities"][number]>().toEqualTypeOf<
      BoundItems["activities"][number]
    >();
  });

  test("have the same JSON Schema, an activity with a required non-empty source", () => {
    const page = z.toJSONSchema(pageActivitySchema, { io: "input" });

    expect(z.toJSONSchema(itemsActivitySchema, { io: "input" })).toStrictEqual(
      page,
    );
    expect(page).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["kind", "id", "label", "source"],
      properties: {
        kind: { type: "string", const: "activity" },
        id: { type: "string" },
        label: { type: "string" },
        source: { type: "string", minLength: 1 },
        actor: { type: "string" },
        action: { type: "string" },
        affects: { type: "array", items: { type: "string" } },
        consumes: { type: "array", items: { type: "string" } },
        produces: { type: "array", items: { type: "string" } },
      },
    });
  });

  test.each([
    { name: "an activity whose id is its source", value: everyField },
    {
      name: "an activity with only its required fields",
      value: { kind: "activity", id: "a:1", source: "a:1", label: "A" },
    },
  ])("both accept $name unchanged", ({ value }) => {
    expect(
      syncPageSchema.parse({ ...emptyPage, activities: [value] }).activities,
    ).toStrictEqual([value]);
    expect(
      boundItemsSchema.parse({ ...emptyItems, activities: [value] }).activities,
    ).toStrictEqual([value]);
  });

  test.each([
    { name: "no source", value: { kind: "activity", id: "a", label: "A" } },
    {
      name: "an empty source",
      value: { kind: "activity", id: "", source: "", label: "A" },
    },
    {
      name: "an id that is not its source",
      value: { kind: "activity", id: "a:1", source: "a:2", label: "A" },
    },
    {
      name: "another element kind",
      value: { kind: "decision", id: "a:1", source: "a:1", label: "A" },
    },
    {
      name: "a field the model does not define",
      value: { ...everyField, url: "https://example.com/issues/1" },
    },
  ])("both reject $name", ({ value }) => {
    expect(
      syncPageSchema.safeParse({ ...emptyPage, activities: [value] }).success,
    ).toBe(false);
    expect(
      boundItemsSchema.safeParse({ ...emptyItems, activities: [value] })
        .success,
    ).toBe(false);
  });
});

test("a sync page's items pass boundItemsSchema unchanged", () => {
  const page = syncPageSchema.parse(
    pageOf([
      {
        id: "github:acme/api#1",
        label: "Parent",
        repository: "github:acme/api",
        state: "open",
        assignees: ["github:@ada"],
      },
      {
        id: "github:acme/api#2",
        label: "Child",
        repository: "github:acme/api",
        state: "done",
        blockedBy: ["github:acme/api#1"],
        parent: "github:acme/api#1",
      },
    ]),
  );
  const items = {
    participants: page.participants,
    activities: page.activities,
    transitions: page.transitions,
    relations: page.relations,
    overlay: page.overlay,
  };

  expect(page.activities).toHaveLength(2);
  expect(page.transitions).toHaveLength(1);
  expect(page.relations).not.toEqual([]);
  expect(boundItemsSchema.parse(items)).toStrictEqual(items);
});
