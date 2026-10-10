import { describe, it } from "vitest";
import { defineModel } from "./model.ts";

/** Every block below must fail to compile. `@ts-expect-error` turns a missing failure into an error, so `typecheck` fails when a regression stops one of them failing. */

describe("defineModel reference checking", () => {
  it("rejects a transition target that was never declared as an element", () => {
    defineModel({
      participants: [],
      events: [],
      actions: [],
      elements: [{ kind: "pseudo", id: "start", role: "initial" }],
      transitions: [
        // @ts-expect-error "nowhere" is not a declared element
        { id: "t1", source: "start", target: "nowhere" },
      ],
      fragments: [],
      projections: [],
    });
  });

  it("rejects an activity whose actor is not a declared participant", () => {
    defineModel({
      participants: [{ id: "shop", label: "Shop", kind: "system" }],
      events: [],
      actions: [],
      elements: [
        // @ts-expect-error "warehouse" is not a declared participant
        { kind: "activity", id: "a1", label: "Pack", actor: "warehouse" },
      ],
      transitions: [],
      fragments: [],
      projections: [],
    });
  });

  it("rejects an identifier from the wrong space: an action id used where an event is expected", () => {
    defineModel({
      participants: [],
      events: [{ id: "ev-go", name: "go" }],
      actions: [{ id: "act-go", name: "go" }],
      elements: [
        { kind: "pseudo", id: "s", role: "initial" },
        { kind: "pseudo", id: "e", role: "final" },
      ],
      transitions: [
        // @ts-expect-error "act-go" is an action id, not an event id
        { id: "t1", source: "s", target: "e", trigger: "act-go" },
      ],
      fragments: [],
      projections: [],
    });
  });

  it("rejects a sequence scenario that names a transition that does not exist", () => {
    defineModel({
      participants: [],
      events: [],
      actions: [],
      elements: [
        { kind: "pseudo", id: "s", role: "initial" },
        { kind: "pseudo", id: "e", role: "final" },
      ],
      transitions: [{ id: "t1", source: "s", target: "e" }],
      fragments: [],
      projections: [
        // @ts-expect-error "t9" is not a declared transition
        { id: "p", notation: "sequence", scenario: ["t1", "t9"] },
      ],
    });
  });

  it("rejects a state machine projection without its subject entity", () => {
    defineModel({
      participants: [],
      events: [],
      actions: [],
      elements: [],
      transitions: [],
      fragments: [],
      projections: [
        // @ts-expect-error a stateMachine projection requires a subject
        { id: "p", notation: "stateMachine" },
      ],
    });
  });

  it("rejects a fragment body that names an undeclared element", () => {
    defineModel({
      participants: [],
      events: [],
      actions: [],
      elements: [{ kind: "pseudo", id: "s", role: "initial" }],
      transitions: [],
      fragments: [
        {
          id: "f1",
          operator: "alt",
          // @ts-expect-error "ghost" is not a declared element
          operands: [{ body: ["s", "ghost"] }],
        },
      ],
      projections: [],
    });
  });

  it("rejects an activity whose actor is an entity: only roles and systems can act", () => {
    defineModel({
      participants: [
        { id: "shop", label: "Shop", kind: "system" },
        { id: "order", label: "Order", kind: "entity" },
      ],
      events: [],
      actions: [],
      elements: [
        // @ts-expect-error "order" is an entity, so it cannot be an actor
        { kind: "activity", id: "a1", label: "Pack", actor: "order" },
      ],
      transitions: [],
      fragments: [],
      projections: [],
    });
  });

  it("rejects a message sent by an entity", () => {
    defineModel({
      participants: [
        { id: "shop", label: "Shop", kind: "system" },
        { id: "order", label: "Order", kind: "entity" },
      ],
      events: [],
      actions: [],
      elements: [
        {
          kind: "message",
          id: "m1",
          label: "Pay",
          // @ts-expect-error "order" is an entity, so it cannot send a message
          from: "order",
          to: "shop",
          mode: "sync",
        },
      ],
      transitions: [],
      fragments: [],
      projections: [],
    });
  });

  it("rejects a state machine subject that is a system, not an entity", () => {
    defineModel({
      participants: [
        { id: "shop", label: "Shop", kind: "system" },
        { id: "order", label: "Order", kind: "entity" },
      ],
      events: [],
      actions: [],
      elements: [],
      transitions: [],
      fragments: [],
      projections: [
        // @ts-expect-error "shop" is a system, so it cannot be a state machine subject
        { id: "p", notation: "stateMachine", subject: "shop" },
      ],
    });
  });
});
