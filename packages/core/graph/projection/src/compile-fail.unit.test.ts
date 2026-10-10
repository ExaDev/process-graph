import { describe, expect, it } from "vitest";
import { toSequence, toStateMachine } from "./index.ts";
import { order } from "./test-support/order.ts";

describe("projection inputs are reference-checked", () => {
  it("rejects a state machine subject that is not a declared participant", () => {
    // @ts-expect-error "nowhere" is not a declared participant
    expect(() => toStateMachine(order, "nowhere")).toThrow();
  });

  it("rejects a state machine subject that is not an entity", () => {
    // @ts-expect-error "shop" is a system, and a state machine subject must be an entity
    expect(() => toStateMachine(order, "shop")).toThrow();
  });

  it("rejects a scenario step that is not a declared transition", () => {
    // @ts-expect-error "t99" is not a declared transition
    expect(() => toSequence(order, ["t1", "t99"])).toThrow();
  });

  it("rejects a scenario step that names an element", () => {
    // @ts-expect-error a step is a transition id, and "a-pack" is an element id
    expect(() => toSequence(order, ["a-pack"])).toThrow();
  });
});
