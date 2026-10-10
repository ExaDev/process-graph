import { defineModel } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { toFlowchart } from "./flowchart.ts";
import { toSequence } from "./sequence.ts";
import { toStateMachine } from "./state-machine.ts";
import { toSwimlane } from "./swimlane.ts";

/** Carries every kind of information a projection can drop: positions, extensions, a message element, a fragment, and an activity that does not affect the subject. */
const rich = defineModel({
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    {
      kind: "activity",
      id: "a-place",
      label: "Place order",
      actor: "customer",
      affects: ["order"],
      extensions: { sequence: { activation: true } },
    },
    {
      kind: "activity",
      id: "a-notify",
      label: "Notify",
      actor: "shop",
      affects: [],
    },
    {
      kind: "message",
      id: "m-ack",
      label: "Acknowledge",
      from: "shop",
      to: "customer",
      mode: "reply",
    },
    { kind: "pseudo", id: "end", role: "final" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "a-place" },
    { id: "t2", source: "a-place", target: "a-notify" },
    { id: "t3", source: "a-notify", target: "end" },
  ],
  fragments: [
    {
      id: "f1",
      operator: "opt",
      operands: [{ body: ["a-notify"] }],
    },
  ],
  projections: [],
  views: {
    flowchart: { "a-place": { x: 1, y: 2 } },
    swimlane: { "a-notify": { x: 3, y: 4 }, "a-place": { x: 5, y: 6 } },
    stateMachine: { start: { x: 0, y: 0 } },
    sequence: { end: { x: 9, y: 9 } },
  },
});

describe("loss reports", () => {
  it("reports the flowchart's own positions, extensions, messages and fragments", () => {
    expect(toFlowchart(rich).loss).toEqual([
      { kind: "layout", elements: ["a-place"] },
      { kind: "extensions", elements: ["a-place"] },
      { kind: "message-elements", elements: ["m-ack"] },
      { kind: "fragments", fragments: ["f1"] },
    ]);
  });

  it("reports only the positions recorded for the swimlane notation", () => {
    expect(toSwimlane(rich).loss).toEqual([
      { kind: "layout", elements: ["a-place", "a-notify"] },
      { kind: "extensions", elements: ["a-place"] },
      { kind: "message-elements", elements: ["m-ack"] },
      { kind: "fragments", fragments: ["f1"] },
    ]);
  });

  it("reports the activities left out of the subject's state machine", () => {
    expect(toStateMachine(rich, "order").loss).toEqual([
      { kind: "layout", elements: ["start"] },
      { kind: "extensions", elements: ["a-place"] },
      { kind: "message-elements", elements: ["m-ack"] },
      { kind: "fragments", fragments: ["f1"] },
      { kind: "subject", subject: "order", elements: ["a-notify"] },
    ]);
  });

  it("reports what a sequence scenario leaves out, and not a fragment it draws", () => {
    const diagram = toSequence(rich, ["t2"]);

    expect(diagram.items.map((item) => item.kind)).toEqual(["fragment"]);
    expect(diagram.loss).toEqual([
      { kind: "layout", elements: ["end"] },
      { kind: "extensions", elements: ["a-place"] },
      { kind: "message-elements", elements: ["m-ack"] },
      { kind: "scenario", elements: ["start", "m-ack", "end"] },
      { kind: "unshown-branches", transitions: ["t3"] },
    ]);
  });

  it("does not report an empty extensions record", () => {
    const bare = defineModel({
      participants: [],
      events: [],
      actions: [],
      artefacts: [],
      elements: [{ kind: "activity", id: "a", label: "A", extensions: {} }],
      transitions: [],
      fragments: [],
      projections: [],
    });

    expect(toFlowchart(bare).loss).toEqual([]);
  });
});
