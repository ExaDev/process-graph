import { describe, expect, it } from "vitest";
import { type ModelIssue, ModelParseError, parseModel } from "./parse.ts";
import { order } from "./test-support/order.ts";

/** Round-trips through JSON text, as a loaded document would arrive. */
const fromJson = (value: unknown): unknown => {
  const parsed: unknown = JSON.parse(JSON.stringify(value));

  return parsed;
};

/** The issues `parseModel` reports for an input it must reject. */
const issuesOf = (input: unknown): readonly ModelIssue[] => {
  try {
    parseModel(input);
  } catch (error) {
    if (error instanceof ModelParseError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("expected parseModel to throw");
};

const withElements = (elements: unknown): unknown => ({ ...order, elements });

describe("parseModel", () => {
  it("loads the order process from JSON text unchanged", () => {
    expect(parseModel(fromJson(order))).toEqual(order);
  });

  it("locates a wrongly typed value by JSON pointer", () => {
    const issues = issuesOf(
      withElements([{ kind: "activity", id: "a", label: 7 }]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      source: "schema",
      pointer: "/elements/0/label",
    });
  });

  it("rejects an unknown key rather than dropping it", () => {
    const issues = issuesOf(
      withElements([{ kind: "pseudo", id: "s", role: "initial", extra: 1 }]),
    );

    expect(issues).toEqual([
      {
        source: "schema",
        pointer: "/elements/0",
        message: 'Unrecognized key: "extra"',
      },
    ]);
  });

  it("locates a value outside a vocabulary", () => {
    const issues = issuesOf({
      ...order,
      participants: [{ id: "x", label: "X", kind: "robot" }],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      source: "schema",
      pointer: "/participants/0/kind",
    });
  });

  it("escapes a slash and a tilde inside a pointer segment", () => {
    const issues = issuesOf({
      ...order,
      events: [{ id: "e", name: "n", payload: { "a/b~c": 3 } }],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      pointer: "/events/0/payload/a~1b~0c",
    });
  });

  it("reports a non-object document at the empty pointer", () => {
    expect(issuesOf(null)).toMatchObject([{ source: "schema", pointer: "" }]);
  });

  it("surfaces what validate reports for a well-shaped model", () => {
    const issues = issuesOf({
      ...order,
      transitions: [{ id: "t1", source: "start", target: "nowhere" }],
      projections: [],
    });

    expect(issues).toEqual([
      {
        source: "validate",
        code: "unknown-reference",
        message: 'transition "t1" target refers to unknown id "nowhere"',
      },
    ]);
  });

  it("keeps an activity's source through loading", () => {
    const activity = {
      kind: "activity",
      id: "a",
      label: "A",
      source: "github:org/repo#1",
    };
    const model = parseModel({
      ...order,
      elements: [activity],
      transitions: [],
      projections: [],
    });

    expect(model.elements).toEqual([activity]);
  });

  it("names every problem in the error message", () => {
    const error = new ModelParseError([
      { source: "schema", pointer: "/a", message: "bad" },
      { source: "validate", code: "duplicate-id", message: "dup" },
    ]);

    expect(error.message).toBe("Invalid model: /a: bad; dup");
    expect(error.name).toBe("ModelParseError");
  });
});
