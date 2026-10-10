import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { OpenIds } from "./ids.ts";
import { defineModel } from "./model.ts";
import {
  OverlayParseError,
  type Overlay,
  type overlaySchema,
  parseOverlay,
  validateOverlay,
} from "./overlay.ts";

/** The issues `parseOverlay` reports for an input it must reject. */
const issuesOf = (input: unknown): OverlayParseError["issues"] => {
  try {
    parseOverlay(input);
  } catch (error) {
    if (error instanceof OverlayParseError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("expected parseOverlay to throw");
};

describe("overlaySchema", () => {
  it("infers exactly the open overlay type", () => {
    expectTypeOf<z.infer<typeof overlaySchema>>().toEqualTypeOf<
      Overlay<OpenIds>
    >();
  });
});

describe("parseOverlay", () => {
  it("loads each status by element identifier", () => {
    const input = {
      "a-submit": "done",
      "a-request": "open",
      "a-pack": "unknown",
    };

    expect(parseOverlay(input)).toEqual(input);
  });

  it("loads an empty overlay", () => {
    expect(parseOverlay({})).toEqual({});
  });

  it("locates a value outside the statuses by JSON pointer", () => {
    const issues = issuesOf({ "a/b": "finished" });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ pointer: "/a~1b" });
  });

  it("rejects a document that is not an object", () => {
    expect(issuesOf(["done"])).toMatchObject([{ pointer: "" }]);
  });

  it("names every problem in the error message", () => {
    const error = new OverlayParseError([
      { pointer: "/a", message: "bad" },
      { pointer: "", message: "worse" },
    ]);

    expect(error.message).toBe("Invalid overlay: /a: bad; /: worse");
    expect(error.name).toBe("OverlayParseError");
  });
});

describe("validateOverlay", () => {
  const model = defineModel({
    participants: [],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "a-submit", label: "Submit" },
      { kind: "activity", id: "a-pack", label: "Pack" },
    ],
    transitions: [],
    fragments: [],
    projections: [],
  });

  it("accepts an overlay whose ids are all declared elements", () => {
    expect(
      validateOverlay(model, { "a-submit": "done", "a-pack": "open" }),
    ).toEqual([]);
  });

  it("reports an id the model does not declare, naming it", () => {
    expect(
      validateOverlay(model, { "a-submit": "done", "a-ship": "open" }),
    ).toEqual([
      {
        code: "overlay-unknown-element",
        message: 'overlay refers to unknown element id "a-ship"',
      },
    ]);
  });

  it("reports an id that names another kind of identifier", () => {
    const issues = validateOverlay(
      defineModel({
        participants: [{ id: "shop", label: "Shop", kind: "system" }],
        events: [],
        actions: [],
        artefacts: [],
        elements: [],
        transitions: [],
        fragments: [],
        projections: [],
      }),
      parseOverlay({ shop: "done" }),
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      "overlay-unknown-element",
    ]);
  });
});
