import { modelSchema, validate } from "@exadev/process-graph-schema";
import { describe, expect, expectTypeOf, test } from "vitest";
import { everyFieldModel, queryModel } from "./conformance.ts";
import { boundActivitySchema, type BoundActivity } from "./schema.ts";

describe("fixtures", () => {
  test.each([
    { name: "everyFieldModel", model: everyFieldModel },
    { name: "queryModel", model: queryModel },
  ])("$name is a valid model", ({ model }) => {
    expect(modelSchema.parse(model)).toStrictEqual(model);
    expect(validate(model)).toEqual([]);
  });
});

describe("boundActivitySchema", () => {
  test("is the model's activity with a required source", () => {
    expectTypeOf<BoundActivity>().toMatchObjectType<{
      readonly kind: "activity";
      readonly source: string;
    }>();
  });

  test("accepts an activity whose id is its source", () => {
    const activity = {
      kind: "activity",
      id: "github:o/r#1",
      label: "One",
      source: "github:o/r#1",
    };

    expect(boundActivitySchema.parse(activity)).toEqual(activity);
  });

  test.each([
    { name: "no source", value: { kind: "activity", id: "a", label: "A" } },
    {
      name: "an id that is not its source",
      value: { kind: "activity", id: "a", label: "A", source: "github:o/r#1" },
    },
    {
      name: "another element kind",
      value: { kind: "decision", id: "d", label: "D" },
    },
  ])("rejects $name", ({ value }) => {
    expect(boundActivitySchema.safeParse(value).success).toBe(false);
  });
});
