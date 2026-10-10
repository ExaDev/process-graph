import { defineModel } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { toStateMachine } from "./state-machine.ts";

/** Order and invoice are both entities; each step affects one of them, or neither. */
const fulfilment = defineModel({
  participants: [
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
    { id: "invoice", label: "Invoice", kind: "entity" },
  ],
  events: [{ id: "ev-paid", name: "paid" }],
  actions: [{ id: "act-issue", name: "issue invoice" }],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    {
      kind: "activity",
      id: "a-accept",
      label: "Accept order",
      actor: "shop",
      affects: ["order"],
    },
    {
      kind: "activity",
      id: "a-invoice",
      label: "Invoice customer",
      actor: "shop",
      action: "act-issue",
      affects: ["invoice"],
    },
    {
      kind: "activity",
      id: "a-ship",
      label: "Ship order",
      actor: "shop",
      affects: ["order"],
    },
    { kind: "pseudo", id: "end", role: "final" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "a-accept" },
    { id: "t2", source: "a-accept", target: "a-invoice" },
    { id: "t3", source: "a-invoice", target: "a-ship", trigger: "ev-paid" },
    { id: "t4", source: "a-ship", target: "end" },
  ],
  fragments: [],
  projections: [],
});

describe("toStateMachine scoping by affects", () => {
  it("keeps only the activities that affect the subject and folds through the rest", () => {
    const machine = toStateMachine(fulfilment, "order");

    expect(machine.states.map((state) => state.id)).toEqual([
      "start",
      "a-accept",
      "a-ship",
      "end",
    ]);
    expect(machine.transitions).toEqual([
      { source: "start", target: "a-accept", transitions: ["t1"] },
      {
        source: "a-accept",
        target: "a-ship",
        event: "ev-paid",
        transitions: ["t2", "t3"],
        through: ["a-invoice"],
      },
      { source: "a-ship", target: "end", transitions: ["t4"] },
    ]);
  });

  it("projects the same model for another subject to a different machine", () => {
    const machine = toStateMachine(fulfilment, "invoice");

    expect(machine.states.map((state) => state.id)).toEqual([
      "start",
      "a-invoice",
      "end",
    ]);
    expect(machine.transitions).toEqual([
      {
        source: "start",
        target: "a-invoice",
        effect: "act-issue",
        transitions: ["t1", "t2"],
        through: ["a-accept"],
      },
      {
        source: "a-invoice",
        target: "end",
        event: "ev-paid",
        transitions: ["t3", "t4"],
        through: ["a-ship"],
      },
    ]);
  });

  it("keeps every activity when no activity declares affects", () => {
    const unscoped = defineModel({
      participants: [{ id: "order", label: "Order", kind: "entity" }],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "activity", id: "a", label: "A" },
        { kind: "activity", id: "b", label: "B" },
      ],
      transitions: [{ id: "t1", source: "a", target: "b" }],
      fragments: [],
      projections: [],
    });

    const machine = toStateMachine(unscoped, "order");

    expect(machine.states.map((state) => state.id)).toEqual(["a", "b"]);
    expect(machine.transitions).toEqual([
      { source: "a", target: "b", transitions: ["t1"] },
    ]);
  });

  it("drops an activity with no affects once any activity declares it", () => {
    const mixed = defineModel({
      participants: [{ id: "order", label: "Order", kind: "entity" }],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "activity", id: "a", label: "A", affects: ["order"] },
        { kind: "activity", id: "undeclared", label: "Undeclared" },
        { kind: "activity", id: "none", label: "None", affects: [] },
      ],
      transitions: [],
      fragments: [],
      projections: [],
    });

    expect(
      toStateMachine(mixed, "order").states.map((state) => state.id),
    ).toEqual(["a"]);
  });

  it("always keeps authored states", () => {
    const authored = defineModel({
      participants: [{ id: "order", label: "Order", kind: "entity" }],
      events: [],
      actions: [],
      artefacts: [],
      elements: [
        { kind: "state", id: "paid", label: "Paid" },
        { kind: "activity", id: "a", label: "A", affects: [] },
      ],
      transitions: [],
      fragments: [],
      projections: [],
    });

    expect(
      toStateMachine(authored, "order").states.map((state) => state.id),
    ).toEqual(["paid"]);
  });
});
