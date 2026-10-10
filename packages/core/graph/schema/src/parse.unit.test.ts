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

  it("round-trips artefacts and an activity's consumes and produces", () => {
    const input = {
      ...order,
      artefacts: [
        { id: "spec", name: "Specification" },
        { id: "release", name: "Release", deliverable: true },
      ],
      elements: [
        {
          kind: "activity",
          id: "a",
          label: "A",
          consumes: ["spec"],
          produces: ["release"],
        },
      ],
      transitions: [],
      projections: [],
    };

    expect(parseModel(fromJson(input))).toEqual(input);
  });

  it("round-trips a transition's trilean condition beside its guard", () => {
    const input = {
      ...order,
      transitions: [
        {
          id: "t1",
          source: "d-authorised",
          target: "a-pack",
          guard: "authorised",
          condition: {
            kind: "and",
            left: {
              kind: "compare",
              op: "gt",
              left: { kind: "reference", key: "amount" },
              right: { kind: "numberLiteral", value: 0 },
            },
            right: {
              kind: "not",
              operand: {
                kind: "textCompare",
                op: "equals",
                left: { kind: "reference", key: "status" },
                right: { kind: "textLiteral", value: "declined" },
              },
            },
          },
        },
      ],
      projections: [],
    };

    expect(parseModel(fromJson(input))).toEqual(input);
  });

  it("locates a malformed condition by JSON pointer", () => {
    const issues = issuesOf({
      ...order,
      transitions: [
        {
          id: "t1",
          source: "d-authorised",
          target: "a-pack",
          condition: { kind: "maybe" },
        },
      ],
      projections: [],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      source: "schema",
      pointer: "/transitions/0/condition/kind",
    });
  });

  it("round-trips an activity's affected entities", () => {
    const activity = {
      kind: "activity",
      id: "a",
      label: "A",
      actor: "shop",
      affects: ["order"],
    };

    expect(
      parseModel(
        fromJson({
          ...order,
          elements: [activity],
          transitions: [],
          projections: [],
        }),
      ).elements,
    ).toEqual([activity]);
  });

  it("round-trips notation-only extensions on every kind of element unchanged", () => {
    const extensions = {
      sequence: { activation: { from: "t2", to: "t4" } },
      stateMachine: { history: "deep", tags: ["a", 1, null, true] },
    };
    const input = {
      ...order,
      elements: [
        { kind: "activity", id: "a", label: "A", extensions },
        { kind: "decision", id: "d", label: "D", extensions },
        { kind: "state", id: "s", label: "S", extensions },
        { kind: "pseudo", id: "p", role: "history", extensions },
        {
          kind: "message",
          id: "m",
          label: "M",
          from: "shop",
          to: "provider",
          mode: "sync",
          extensions,
        },
      ],
      transitions: [],
      projections: [],
    };

    expect(parseModel(fromJson(input))).toEqual(input);
  });

  it("rejects an extension value that is not JSON", () => {
    const issues = issuesOf({
      ...order,
      elements: [
        {
          kind: "activity",
          id: "a",
          label: "A",
          extensions: { sequence: { at: undefined, fn: () => 1 } },
        },
      ],
      transitions: [],
      projections: [],
    });

    expect(issues).toMatchObject([
      { source: "schema", pointer: "/elements/0/extensions/sequence" },
    ]);
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
