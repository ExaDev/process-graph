import { defineModel } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { toFlowchart } from "./flowchart.ts";
import { toSequence } from "./sequence.ts";
import { toStateMachine } from "./state-machine.ts";
import { toSwimlane } from "./swimlane.ts";
import { fanThroughShape } from "./test-support/shapes.ts";

/** The smallest fan where folding multiplies: three times three exceeds three plus three. */
const fanned = 3;

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

  describe("elements a notation cannot draw", () => {
    /** A `state` and a `history` pseudo-state, which no flowchart shape exists for, plus a fork that a flowchart draws and a state machine does not. */
    const stateful = defineModel({
      participants: [
        { id: "customer", label: "Customer", kind: "role" },
        { id: "order", label: "Order", kind: "entity" },
      ],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "pseudo", id: "start", role: "initial" },
        { kind: "activity", id: "a-pay", label: "Pay", actor: "customer" },
        { kind: "state", id: "s-paid", label: "Paid" },
        { kind: "pseudo", id: "h", role: "history" },
        { kind: "pseudo", id: "fork", role: "fork" },
        { kind: "pseudo", id: "end", role: "final" },
      ],
      transitions: [
        { id: "t1", source: "start", target: "a-pay" },
        { id: "t2", source: "a-pay", target: "s-paid" },
        { id: "t3", source: "s-paid", target: "h" },
        { id: "t4", source: "a-pay", target: "fork" },
        { id: "t5", source: "fork", target: "end" },
      ],
      fragments: [],
      projections: [],
    });

    it("reports the state and the history pseudo-state a flowchart drops, with their transitions", () => {
      const flow = toFlowchart(stateful);

      expect(flow.nodes.map((node) => node.id)).toEqual([
        "start",
        "a-pay",
        "fork",
        "end",
      ]);
      expect(flow.loss).toEqual([
        {
          kind: "unrepresented-elements",
          notation: "flowchart",
          elements: [
            { element: "s-paid", kind: "state" },
            { element: "h", kind: "history" },
          ],
          transitions: ["t2", "t3"],
        },
      ]);
    });

    it("reports the same drop for a swimlane under its own notation", () => {
      expect(toSwimlane(stateful).loss).toEqual([
        {
          kind: "unrepresented-elements",
          notation: "swimlane",
          elements: [
            { element: "s-paid", kind: "state" },
            { element: "h", kind: "history" },
          ],
          transitions: ["t2", "t3"],
        },
      ]);
    });

    it("reports the fork and history a state machine has no state for, and leaves no transition pointing at them", () => {
      const machine = toStateMachine(stateful, "order");

      expect(machine.states.map((state) => state.id)).toEqual([
        "start",
        "a-pay",
        "s-paid",
        "end",
      ]);
      expect(machine.transitions.map((t) => [t.source, t.target])).toEqual([
        ["start", "a-pay"],
        ["a-pay", "s-paid"],
      ]);
      expect(machine.loss).toEqual([
        {
          kind: "unrepresented-elements",
          notation: "stateMachine",
          elements: [
            { element: "h", kind: "history" },
            { element: "fork", kind: "fork" },
          ],
          transitions: ["t3", "t4", "t5"],
        },
      ]);
    });

    it("does not report a decision a state machine folds into guards", () => {
      const decided = defineModel({
        participants: [{ id: "order", label: "Order", kind: "entity" }],
        events: [],
        actions: [],
        artefacts: [],
        elements: [
          { kind: "activity", id: "a", label: "A" },
          { kind: "decision", id: "d", label: "D" },
          { kind: "activity", id: "b", label: "B" },
        ],
        transitions: [
          { id: "t1", source: "a", target: "d" },
          { id: "t2", source: "d", target: "b", guard: "yes" },
        ],
        fragments: [],
        projections: [],
      });

      expect(toStateMachine(decided, "order").loss).toEqual([]);
    });
  });

  it("reports scenario steps that touch an element with no actor as skipped", () => {
    const partial = defineModel({
      participants: [
        { id: "customer", label: "Customer", kind: "role" },
        { id: "shop", label: "Shop", kind: "system" },
      ],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "pseudo", id: "start", role: "initial" },
        { kind: "activity", id: "a", label: "A", actor: "customer" },
        { kind: "activity", id: "b", label: "B", actor: "shop" },
      ],
      transitions: [
        { id: "t1", source: "start", target: "a" },
        { id: "t2", source: "a", target: "b" },
      ],
      fragments: [],
      projections: [],
    });

    expect(toSequence(partial, ["t1", "t2"]).loss).toEqual([
      { kind: "skipped-steps", transitions: ["t1"] },
    ]);
  });

  it("reports a message whose folding would multiply edges as unrepresented, with its transitions", () => {
    // Three sources through one message to three ends: folding would draw nine edges where the model has six transitions.
    const { model } = fanThroughShape(1)(fanned);

    expect(toFlowchart(model).edges).toEqual([]);
    expect(toFlowchart(model).loss).toEqual([
      {
        kind: "unrepresented-elements",
        notation: "flowchart",
        elements: [{ element: "m-0", kind: "message" }],
        transitions: ["t-s-0", "t-s-1", "t-s-2", "t-e-0", "t-e-1", "t-e-2"],
      },
    ]);
    expect(toStateMachine(model, "order").loss).toContainEqual({
      kind: "unrepresented-elements",
      notation: "stateMachine",
      elements: [{ element: "m-0", kind: "message" }],
      transitions: ["t-s-0", "t-s-1", "t-s-2", "t-e-0", "t-e-1", "t-e-2"],
    });
  });
});
