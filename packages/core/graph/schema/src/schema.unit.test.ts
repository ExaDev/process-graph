import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { Model, OpenIds } from "./index.ts";
import { modelSchema } from "./schema.ts";
import { order } from "./test-support/order.ts";

describe("modelSchema", () => {
  it("infers exactly the open model type", () => {
    expectTypeOf<z.infer<typeof modelSchema>>().toEqualTypeOf<Model<OpenIds>>();
  });

  it("accepts the order process", () => {
    expect(modelSchema.parse(order)).toEqual(order);
  });
});
