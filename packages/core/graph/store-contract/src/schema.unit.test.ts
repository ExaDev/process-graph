import {
  boundActivitySchema,
  modelSchema,
  validate,
  type Extensions,
} from "@exadev/process-graph-schema";
import { describe, expect, expectTypeOf, test } from "vitest";
import { everyFieldModel, queryModel } from "./conformance.ts";
import { boundItemsSchema, type BoundItems } from "./schema.ts";

describe("fixtures", () => {
  test.each([
    { name: "everyFieldModel", model: everyFieldModel },
    { name: "queryModel", model: queryModel },
  ])("$name is a valid model", ({ model }) => {
    expect(modelSchema.parse(model)).toStrictEqual(model);
    expect(validate(model)).toEqual([]);
  });
});

describe("boundItemsSchema", () => {
  test("holds activities exactly as the model's activity with a required source", () => {
    expectTypeOf<BoundItems["activities"][number]>().toEqualTypeOf<{
      readonly kind: "activity";
      readonly id: string;
      readonly extensions?: Extensions;
      readonly label: string;
      readonly actor?: string;
      readonly action?: string;
      readonly source: string;
      readonly affects?: readonly string[];
      readonly consumes?: readonly string[];
      readonly produces?: readonly string[];
    }>();
  });

  test("holds activities parsed by graph-schema's boundActivitySchema itself", () => {
    expect(boundItemsSchema.unwrap().shape.activities.unwrap().element).toBe(
      boundActivitySchema,
    );
  });
});
