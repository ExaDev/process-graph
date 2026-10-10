import { describe, expect, it } from "vitest";
import type { Model, OpenIds } from "./index.ts";
import { validate } from "./validate.ts";
import { order } from "./test-support/order.ts";

/** A runtime model: identifiers are plain strings, so references are not checked at compile time. */
const open = (overrides: Partial<Model<OpenIds>>): Model<OpenIds> => ({
  participants: [
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [],
  actions: [],
  elements: [
    { kind: "pseudo", id: "s", role: "initial" },
    { kind: "pseudo", id: "e", role: "final" },
  ],
  transitions: [{ id: "t1", source: "s", target: "e" }],
  fragments: [],
  projections: [],
  ...overrides,
});

describe("validate", () => {
  it("reports nothing for the order process", () => {
    expect(validate(order)).toEqual([]);
  });

  it("reports a duplicate identifier within one space", () => {
    const issues = validate(
      open({
        elements: [
          { kind: "pseudo", id: "s", role: "initial" },
          { kind: "pseudo", id: "s", role: "final" },
        ],
        transitions: [],
      }),
    );

    expect(issues).toEqual([
      { code: "duplicate-id", message: 'Duplicate element id "s"' },
    ]);
  });

  it("allows the same identifier in different spaces", () => {
    expect(
      validate(
        open({
          events: [{ id: "s", name: "s" }],
        }),
      ),
    ).toEqual([]);
  });

  it("reports an unknown reference with where it occurs", () => {
    const issues = validate(
      open({ transitions: [{ id: "t1", source: "s", target: "nowhere" }] }),
    );

    expect(issues).toEqual([
      {
        code: "unknown-reference",
        message: 'transition "t1" target refers to unknown id "nowhere"',
      },
    ]);
  });

  it("reports an entity used as an actor", () => {
    const issues = validate(
      open({
        elements: [{ kind: "activity", id: "a", label: "A", actor: "order" }],
        transitions: [],
      }),
    );

    expect(issues).toEqual([
      {
        code: "actor-is-entity",
        message:
          'activity "a" actor refers to entity "order", which cannot act',
      },
    ]);
  });

  it("reports several initial pseudo-states in one scope", () => {
    const issues = validate(
      open({
        elements: [
          { kind: "pseudo", id: "s1", role: "initial" },
          { kind: "pseudo", id: "s2", role: "initial" },
        ],
        transitions: [],
      }),
    );

    expect(issues).toEqual([
      {
        code: "multiple-initial",
        message: "the top level has 2 initial pseudo-states",
      },
    ]);
  });

  it("reports a state machine subject that is not an entity", () => {
    const issues = validate(
      open({
        projections: [{ id: "p", notation: "stateMachine", subject: "shop" }],
      }),
    );

    expect(issues).toEqual([
      {
        code: "subject-not-entity",
        message: 'projection "p" subject "shop" is not an entity',
      },
    ]);
  });

  it("reports a scenario step that is not a declared transition", () => {
    const issues = validate(
      open({
        projections: [{ id: "p", notation: "sequence", scenario: ["t9"] }],
      }),
    );

    expect(issues).toEqual([
      {
        code: "unknown-reference",
        message: 'projection "p" scenario refers to unknown id "t9"',
      },
    ]);
  });

  it("reports a fragment body that names an unknown element", () => {
    const issues = validate(
      open({
        fragments: [
          { id: "f", operator: "alt", operands: [{ body: ["s", "ghost"] }] },
        ],
      }),
    );

    expect(issues).toEqual([
      {
        code: "unknown-reference",
        message: 'fragment "f" body refers to unknown id "ghost"',
      },
    ]);
  });

  it("reports an activity source used by two activities", () => {
    const issues = validate(
      open({
        elements: [
          {
            kind: "activity",
            id: "a",
            label: "A",
            source: "github:org/repo#1",
          },
          {
            kind: "activity",
            id: "b",
            label: "B",
            source: "github:org/repo#1",
          },
          {
            kind: "activity",
            id: "c",
            label: "C",
            source: "github:org/repo#2",
          },
        ],
        transitions: [],
      }),
    );

    expect(issues).toEqual([
      {
        code: "duplicate-source",
        message: 'Duplicate activity source "github:org/repo#1"',
      },
    ]);
  });

  it("allows activities without a source to repeat the absence", () => {
    const issues = validate(
      open({
        elements: [
          { kind: "activity", id: "a", label: "A" },
          { kind: "activity", id: "b", label: "B" },
        ],
        transitions: [],
      }),
    );

    expect(issues).toEqual([]);
  });
});
