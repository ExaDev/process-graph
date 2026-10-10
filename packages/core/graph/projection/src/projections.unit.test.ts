import { describe, expect, it } from "vitest";
import {
  handoffs,
  toFlowchart,
  toSequence,
  toStateMachine,
  toSwimlane,
} from "./index.ts";
import { order } from "./test-support/order.ts";

const shipped = ["t1", "t2", "t3", "t4", "t5", "t7"] as const;
const cancelled = ["t1", "t2", "t3", "t4", "t6", "t8"] as const;

describe("the order process", () => {
  it("has a hand-off wherever a transition changes actor", () => {
    expect(handoffs(order)).toEqual([
      { transition: "t2", from: "customer", to: "shop" },
      { transition: "t3", from: "shop", to: "provider" },
      { transition: "t4", from: "provider", to: "shop" },
    ]);
  });

  it("projects to a flowchart of steps and decisions with guarded edges", () => {
    const flow = toFlowchart(order);

    expect(flow.loss).toEqual([{ kind: "layout", elements: ["a-request"] }]);
    expect(flow.nodes).toEqual([
      { id: "start", label: "Start", shape: "terminator" },
      { id: "a-submit", label: "Submit order", shape: "process" },
      { id: "a-request", label: "Request payment", shape: "process" },
      { id: "a-authorise", label: "Authorise or decline", shape: "process" },
      { id: "d-authorised", label: "Payment authorised?", shape: "decision" },
      { id: "a-pack", label: "Pack and ship", shape: "process" },
      { id: "a-cancel", label: "Cancel order and notify", shape: "process" },
      { id: "end", label: "End", shape: "terminator" },
    ]);
    expect(flow.edges).toEqual([
      { from: "start", to: "a-submit" },
      { from: "a-submit", to: "a-request" },
      { from: "a-request", to: "a-authorise" },
      { from: "a-authorise", to: "d-authorised" },
      { from: "d-authorised", to: "a-pack", label: "authorised" },
      { from: "d-authorised", to: "a-cancel", label: "declined" },
      { from: "a-pack", to: "end" },
      { from: "a-cancel", to: "end" },
    ]);
  });

  it("projects to a swimlane with a lane per actor that has elements", () => {
    const lanes = toSwimlane(order);

    expect(lanes.lanes).toEqual([
      { participant: "customer", label: "Customer", nodes: ["a-submit"] },
      {
        participant: "shop",
        label: "Shop",
        nodes: ["a-request", "d-authorised", "a-pack", "a-cancel"],
      },
      {
        participant: "provider",
        label: "Payment provider",
        nodes: ["a-authorise"],
      },
    ]);
    expect(lanes.loss).toEqual([]);
    expect(lanes.unassigned).toEqual(["start", "end"]);
    expect(lanes.handoffs).toEqual(handoffs(order));
  });

  it("projects to a state machine of the order with decisions folded into guards", () => {
    const machine = toStateMachine(order, "order");

    expect(machine.subject).toBe("order");
    expect(machine.loss).toEqual([]);
    expect(machine.states).toEqual([
      { id: "start", label: "Start", role: "initial" },
      { id: "a-submit", label: "Submit order", role: "state" },
      { id: "a-request", label: "Request payment", role: "state" },
      { id: "a-authorise", label: "Authorise or decline", role: "state" },
      { id: "a-pack", label: "Pack and ship", role: "state" },
      { id: "a-cancel", label: "Cancel order and notify", role: "state" },
      { id: "end", label: "End", role: "final" },
    ]);
    expect(machine.transitions).toEqual([
      { source: "start", target: "a-submit", event: "ev-submitted" },
      { source: "a-submit", target: "a-request", effect: "act-request" },
      { source: "a-request", target: "a-authorise" },
      {
        source: "a-authorise",
        target: "a-pack",
        event: "ev-authorised",
        guard: "authorised",
        effect: "act-pack",
      },
      {
        source: "a-authorise",
        target: "a-cancel",
        event: "ev-declined",
        guard: "declined",
        effect: "act-cancel",
      },
      { source: "a-pack", target: "end" },
      { source: "a-cancel", target: "end" },
    ]);
  });

  it("projects the shipped path to a sequence diagram", () => {
    expect(toSequence(order, shipped)).toEqual({
      lifelines: ["customer", "shop", "provider"],
      messages: [
        {
          transition: "t2",
          from: "customer",
          to: "shop",
          label: "Request payment",
        },
        {
          transition: "t3",
          from: "shop",
          to: "provider",
          label: "Authorise or decline",
        },
        {
          transition: "t4",
          from: "provider",
          to: "shop",
          label: "Payment authorised?",
        },
        {
          transition: "t5",
          from: "shop",
          to: "shop",
          label: "payment authorised",
        },
      ],
      items: [
        {
          kind: "message",
          message: {
            transition: "t2",
            from: "customer",
            to: "shop",
            label: "Request payment",
          },
        },
        {
          kind: "message",
          message: {
            transition: "t3",
            from: "shop",
            to: "provider",
            label: "Authorise or decline",
          },
        },
        {
          kind: "message",
          message: {
            transition: "t4",
            from: "provider",
            to: "shop",
            label: "Payment authorised?",
          },
        },
        {
          kind: "message",
          message: {
            transition: "t5",
            from: "shop",
            to: "shop",
            label: "payment authorised",
          },
        },
      ],
      loss: [
        { kind: "scenario", elements: ["a-cancel"] },
        { kind: "unshown-branches", transitions: ["t6"] },
      ],
    });
  });

  it("projects the cancelled path to a different sequence diagram", () => {
    const diagram = toSequence(order, cancelled);

    expect(diagram.lifelines).toEqual(["customer", "shop", "provider"]);
    expect(diagram.loss).toEqual([
      { kind: "scenario", elements: ["a-pack"] },
      { kind: "unshown-branches", transitions: ["t5"] },
    ]);
    expect(diagram.messages.map((message) => message.label)).toEqual([
      "Request payment",
      "Authorise or decline",
      "Payment authorised?",
      "payment declined",
    ]);
  });
});
