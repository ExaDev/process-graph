import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { Element, Extensions, Model, OpenIds } from "./index.ts";
import {
  boundActivitySchema,
  modelSchema,
  type BoundActivity,
} from "./schema.ts";
import { order } from "./test-support/order.ts";

describe("modelSchema", () => {
  it("infers exactly the open model type", () => {
    expectTypeOf<z.infer<typeof modelSchema>>().toEqualTypeOf<Model<OpenIds>>();
  });

  it("accepts the order process", () => {
    expect(modelSchema.parse(order)).toEqual(order);
  });
});

describe("boundActivitySchema", () => {
  const bound = {
    kind: "activity",
    id: "github:o/r#1",
    source: "github:o/r#1",
    label: "One",
  };

  it("is exactly the model's activity with a required source", () => {
    expectTypeOf<BoundActivity>().toEqualTypeOf<{
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
    expectTypeOf<BoundActivity>().toExtend<Element<string, OpenIds>>();
  });

  it("accepts an activity whose id is its source, which is also a model element", () => {
    expect(boundActivitySchema.parse(bound)).toStrictEqual(bound);
    expect(modelSchema.unwrap().shape.elements.parse([bound])).toStrictEqual([
      bound,
    ]);
  });

  it.each([
    { name: "no source", value: { kind: "activity", id: "a", label: "A" } },
    {
      name: "an empty source",
      value: { kind: "activity", id: "", source: "", label: "A" },
    },
    {
      name: "an id that is not its source",
      value: { ...bound, source: "github:o/r#2" },
    },
    {
      name: "another element kind",
      value: { kind: "decision", id: "d", source: "d", label: "D" },
    },
    {
      name: "a field the model does not define",
      value: { ...bound, url: "https://example.com/issues/1" },
    },
  ])("rejects $name", ({ value }) => {
    expect(boundActivitySchema.safeParse(value).success).toBe(false);
  });

  it("reports an id that is not its source at the id", () => {
    const result = boundActivitySchema.safeParse({
      ...bound,
      source: "github:o/r#2",
    });

    expect(result.error?.issues).toMatchObject([
      { path: ["id"], message: "a bound activity's id must equal its source" },
    ]);
  });
});
