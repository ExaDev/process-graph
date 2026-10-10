import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import {
  handoffs,
  toFlowchart,
  toSequence,
  toStateMachine,
  toSwimlane,
  type SequenceItem,
  type SequenceMessage,
} from "./index.ts";
import { order } from "./test-support/order.ts";
import {
  orderWithFulfilment,
  orderWithMessages,
  orderWithRetry,
} from "./test-support/order-variants.ts";

const message = (
  transition: string,
  from: string,
  to: string,
  label: string,
): SequenceItem<OpenIds> => ({
  kind: "message",
  message: { transition, from, to, label },
});

const request = message("t2", "customer", "shop", "Request payment");
const authorise = message("t3", "shop", "provider", "Authorise or decline");
const decide = message("t4", "provider", "shop", "Payment authorised?");

describe("sequence fragments derived from the order process's structure", () => {
  it("wraps the shipped path's authorised branch in an alt from the decision", () => {
    const diagram = toSequence(order, ["t1", "t2", "t3", "t4", "t5", "t7"]);

    expect(diagram.items).toEqual([
      request,
      authorise,
      decide,
      {
        kind: "fragment",
        element: "d-authorised",
        operator: "alt",
        operands: [
          {
            guard: "authorised",
            items: [message("t5", "shop", "shop", "payment authorised")],
          },
        ],
      },
    ]);
  });

  it("wraps the cancelled path's declined branch in the same decision's alt", () => {
    const diagram = toSequence(order, ["t1", "t2", "t3", "t4", "t6", "t8"]);

    expect(diagram.items.at(-1)).toEqual({
      kind: "fragment",
      element: "d-authorised",
      operator: "alt",
      operands: [
        {
          guard: "declined",
          items: [message("t6", "shop", "shop", "payment declined")],
        },
      ],
    });
  });

  it("wraps a retried payment in a loop guarded by the way back, then the alt for the way out", () => {
    const diagram = toSequence(orderWithRetry, [
      "t1",
      "t2",
      "t3",
      "t4",
      "t6",
      "t9",
      "t3",
      "t4",
      "t5",
      "t7",
    ]);

    expect(diagram.items).toEqual([
      {
        kind: "fragment",
        element: "d-authorised",
        operator: "loop",
        operands: [
          {
            guard: "declined",
            items: [
              request,
              authorise,
              decide,
              message("t6", "shop", "customer", "payment declined"),
              message("t9", "customer", "shop", "Request payment"),
              authorise,
              decide,
            ],
          },
        ],
      },
      {
        kind: "fragment",
        element: "d-authorised",
        operator: "alt",
        operands: [
          {
            guard: "authorised",
            items: [message("t5", "shop", "shop", "payment authorised")],
          },
        ],
      },
    ]);
  });

  it("wraps parallel fulfilment in a par from the fork and an optional step in an opt, inside the authorised branch", () => {
    const diagram = toSequence(orderWithFulfilment, [
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "tf1",
      "tj1",
      "tf2",
      "tj2",
      "tg",
      "tw",
      "tw2",
    ]);

    expect(diagram.items).toEqual([
      request,
      authorise,
      decide,
      {
        kind: "fragment",
        element: "d-authorised",
        operator: "alt",
        operands: [
          {
            guard: "authorised",
            items: [
              {
                kind: "fragment",
                element: "fork",
                operator: "par",
                operands: [
                  { items: [message("tf1", "shop", "shop", "Pack and ship")] },
                  {
                    items: [message("tf2", "shop", "provider", "Send receipt")],
                  },
                ],
              },
              message("tg", "provider", "shop", "Gift wrap?"),
              {
                kind: "fragment",
                element: "d-gift",
                operator: "opt",
                operands: [
                  {
                    guard: "gift",
                    items: [message("tw", "shop", "shop", "Wrap gift")],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(diagram.loss).toContainEqual({
      kind: "skipped-steps",
      transitions: ["t1", "t5", "tj1", "tj2", "tw2"],
    });
  });

  it("does not draw a derived fragment that holds exactly the messages of an authored one", () => {
    const authored: Model<OpenIds> = {
      ...order,
      fragments: [
        {
          id: "f-outcome",
          operator: "alt",
          operands: [
            { guard: "paid", body: ["a-pack"] },
            { guard: "unpaid", body: ["a-cancel"] },
          ],
        },
      ],
    };

    expect(
      toSequence(authored, ["t1", "t2", "t3", "t4", "t5", "t7"]).items.at(-1),
    ).toEqual({
      kind: "fragment",
      fragment: "f-outcome",
      operator: "alt",
      operands: [
        {
          guard: "paid",
          items: [message("t5", "shop", "shop", "payment authorised")],
        },
      ],
    });
  });
});

describe("message elements in the order process", () => {
  const shipped = ["t1", "t2", "t3a", "t3b", "t4", "t5", "t7a", "t7b"] as const;

  it("draws a message element on the sequence path with its own ends, label and mode", () => {
    const diagram = toSequence(orderWithMessages, shipped);
    const charge: SequenceMessage<OpenIds> = {
      transition: "t3a",
      from: "shop",
      to: "provider",
      label: "Charge card",
      element: "m-charge",
      mode: "sync",
    };
    const dispatch: SequenceMessage<OpenIds> = {
      transition: "t7a",
      from: "shop",
      to: "customer",
      label: "Dispatch notice",
      element: "m-dispatch",
      mode: "async",
    };

    expect(diagram.messages).toEqual([
      {
        transition: "t2",
        from: "customer",
        to: "shop",
        label: "Request payment",
      },
      charge,
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
      dispatch,
    ]);
    expect(diagram.items.at(-1)).toEqual({
      kind: "fragment",
      element: "d-authorised",
      operator: "alt",
      operands: [
        {
          guard: "authorised",
          items: [
            message("t5", "shop", "shop", "payment authorised"),
            { kind: "message", message: dispatch },
          ],
        },
      ],
    });
    expect(diagram.loss).toEqual([
      { kind: "scenario", elements: ["a-cancel"] },
      { kind: "unshown-branches", transitions: ["t6"] },
      { kind: "skipped-steps", transitions: ["t1"] },
    ]);
  });

  it("carries a message element on the flowchart edge between the steps it connects", () => {
    const flow = toFlowchart(orderWithMessages);

    expect(flow.nodes.map((node) => node.id)).not.toContain("m-charge");
    expect(flow.edges).toContainEqual({
      from: "a-request",
      to: "a-authorise",
      label: "Charge card",
      transitions: ["t3a", "t3b"],
      through: ["m-charge"],
    });
    expect(flow.edges).toContainEqual({
      from: "a-pack",
      to: "end",
      label: "Dispatch notice",
      transitions: ["t7a", "t7b"],
      through: ["m-dispatch"],
    });
    expect(flow.loss).toEqual([]);
  });

  it("keeps the payment request a hand-off from shop to provider when a message carries it", () => {
    expect(handoffs(orderWithMessages)).toEqual([
      { transition: "t2", from: "customer", to: "shop" },
      {
        transition: "t3a",
        from: "shop",
        to: "provider",
        through: ["m-charge"],
      },
      { transition: "t4", from: "provider", to: "shop" },
    ]);
    expect(toSwimlane(orderWithMessages).loss).toEqual([]);
  });

  it("folds a message element into the state machine transition it carries, triggered by its event", () => {
    const machine = toStateMachine(orderWithMessages, "order");

    expect(machine.transitions).toContainEqual({
      source: "a-request",
      target: "a-authorise",
      event: "ev-charge",
      transitions: ["t3a", "t3b"],
      through: ["m-charge"],
    });
    expect(machine.transitions).toContainEqual({
      source: "a-pack",
      target: "end",
      transitions: ["t7a", "t7b"],
      through: ["m-dispatch"],
    });
    expect(machine.loss).toEqual([]);
  });

  it("still reports a message element that no step reaches", () => {
    const stray: Model<OpenIds> = {
      ...orderWithMessages,
      elements: [
        ...orderWithMessages.elements,
        {
          kind: "message",
          id: "m-survey",
          label: "Survey",
          from: "shop",
          to: "customer",
          mode: "async",
        },
      ],
    };

    expect(toFlowchart(stray).loss).toEqual([
      { kind: "message-elements", elements: ["m-survey"] },
    ]);
    expect(toStateMachine(stray, "order").loss).toEqual([
      { kind: "message-elements", elements: ["m-survey"] },
    ]);
    expect(toSequence(stray, shipped).loss).toContainEqual({
      kind: "message-elements",
      elements: ["m-survey"],
    });
  });
});

describe("state machine scope and empty lanes on the order process", () => {
  it("leaves out the steps that do not affect the order and folds through them", () => {
    const scoped: Model<OpenIds> = {
      ...order,
      elements: order.elements.map(
        (element): Model<OpenIds>["elements"][number] =>
          element.kind === "activity"
            ? {
                ...element,
                affects: element.id === "a-authorise" ? [] : ["order"],
              }
            : element,
      ),
    };
    const machine = toStateMachine(scoped, "order");

    expect(machine.states.map((state) => state.id)).not.toContain(
      "a-authorise",
    );
    expect(machine.transitions).toContainEqual({
      source: "a-request",
      target: "a-pack",
      event: "ev-authorised",
      guard: "authorised",
      effect: "act-pack",
      transitions: ["t3", "t4", "t5"],
      through: ["a-authorise", "d-authorised"],
    });
    expect(machine.loss).toContainEqual({
      kind: "subject",
      subject: "order",
      elements: ["a-authorise"],
    });
  });

  it("draws a lane for a declared participant with no elements", () => {
    const withCourier: Model<OpenIds> = {
      ...order,
      participants: [
        ...order.participants,
        { id: "courier", label: "Courier", kind: "system" },
      ],
    };

    expect(toSwimlane(withCourier).lanes.at(-1)).toEqual({
      participant: "courier",
      label: "Courier",
      nodes: [],
    });
  });
});
