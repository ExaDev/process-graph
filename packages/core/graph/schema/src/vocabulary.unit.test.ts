import { describe, expectTypeOf, test } from "vitest";
import type { Element } from "./declarations.ts";
import type { OpenIds } from "./ids.ts";
import type { ElementKind } from "./vocabulary.ts";

describe("elementKinds", () => {
  test("names exactly the variants of Element", () => {
    expectTypeOf<ElementKind>().toEqualTypeOf<
      Element<string, OpenIds>["kind"]
    >();
  });
});
