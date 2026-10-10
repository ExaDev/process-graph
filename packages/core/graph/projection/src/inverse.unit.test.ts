import {
  validate,
  type Model,
  type OpenIds,
} from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import {
  applyModelDiff,
  confirmChanges,
  diffFlowchart,
  diffSequence,
  diffStateMachine,
  diffSwimlane,
  handoffs,
  toFlowchart,
  toSequence,
  toStateMachine,
  toSwimlane,
  UnconfirmedChangeError,
  type ModelDiff,
  type SequenceMessage,
} from "./index.ts";
import { order } from "./test-support/order.ts";
import { orderWithMessages } from "./test-support/order-variants.ts";

/** The order process in the open identifier space, so an edit can introduce identifiers it does not declare. */
const model: Model<OpenIds> = { ...order };
const shipped = ["t1", "t2", "t3", "t4", "t5", "t7"];

const confirmAll = (diff: ModelDiff<OpenIds>): ModelDiff<OpenIds> =>
  confirmChanges(diff, () => true);

describe("diffFlowchart on the order process", () => {
  const flow = toFlowchart(model);
  const edited = {
    nodes: [
      ...flow.nodes
        .filter((node) => node.id !== "a-cancel")
        .map((node) =>
          node.id === "a-pack" ? { ...node, label: "Pack and dispatch" } : node,
        ),
      { id: "a-gift", label: "Gift wrap", shape: "process" as const },
    ],
    edges: [
      ...flow.edges
        .filter(
          (edge) =>
            !edge.transitions.includes("t6") &&
            !edge.transitions.includes("t8"),
        )
        .map((edge) => {
          if (edge.transitions.includes("t7")) {
            return { ...edge, from: "a-gift" };
          }

          return edge.transitions.includes("t5")
            ? { ...edge, label: "approved" }
            : edge;
        }),
      { from: "a-pack", to: "a-gift", transitions: ["t9"] },
    ],
  };

  it("reports removed, renamed and added steps and the rewired, relabelled, removed and added transitions", () => {
    expect(diffFlowchart(model, edited)).toEqual({
      elements: [
        { kind: "removed", element: "a-cancel", inferred: false },
        {
          kind: "renamed",
          element: "a-pack",
          from: "Pack and ship",
          to: "Pack and dispatch",
          inferred: false,
        },
        {
          kind: "added",
          element: { kind: "activity", id: "a-gift", label: "Gift wrap" },
          inferred: false,
        },
      ],
      transitions: [
        { kind: "removed", transition: "t6", inferred: false },
        { kind: "removed", transition: "t8", inferred: false },
        {
          kind: "changed",
          field: "guard",
          transition: "t5",
          from: "authorised",
          to: "approved",
          inferred: false,
        },
        {
          kind: "rewired",
          transition: "t7",
          from: { source: "a-pack", target: "end" },
          to: { source: "a-gift", target: "end" },
          inferred: false,
        },
        {
          kind: "added",
          transition: { id: "t9", source: "a-pack", target: "a-gift" },
          inferred: false,
        },
      ],
      events: [],
    });
  });

  it("applies to a valid model whose flowchart is the edited one", () => {
    const applied = applyModelDiff(model, diffFlowchart(model, edited));

    expect(validate(applied)).toEqual([]);
    expect(toFlowchart(applied).nodes).toEqual(edited.nodes);
    expect(toFlowchart(applied).edges).toEqual(
      expect.arrayContaining(edited.edges),
    );
    expect(toFlowchart(applied).edges).toHaveLength(edited.edges.length);
  });

  it("infers a new terminator's role and holds it back until confirmed", () => {
    const diff = diffFlowchart(model, {
      nodes: [
        ...flow.nodes,
        { id: "abandoned", label: "End", shape: "terminator" },
      ],
      edges: [
        ...flow.edges,
        { from: "a-cancel", to: "abandoned", transitions: ["t9"] },
      ],
    });

    expect(diff.elements).toEqual([
      {
        kind: "added",
        element: { kind: "pseudo", id: "abandoned", role: "final" },
        inferred: true,
      },
    ]);
    expect(() => applyModelDiff(model, diff)).toThrow(UnconfirmedChangeError);
    expect(applyModelDiff(model, confirmAll(diff)).elements.at(-1)).toEqual({
      kind: "pseudo",
      id: "abandoned",
      role: "final",
    });
  });

  it("refuses a change of shape, which would change the element's kind", () => {
    expect(() =>
      diffFlowchart(model, {
        nodes: flow.nodes.map((node) =>
          node.id === "a-pack" ? { ...node, shape: "decision" as const } : node,
        ),
        edges: flow.edges,
      }),
    ).toThrow(/changed shape from process to decision/u);
  });
});

describe("diffSwimlane on the order process", () => {
  const lanes = toSwimlane(model);

  it("relanes a step moved to another actor's lane, making the cancellation a hand-off to the customer", () => {
    const edited = {
      ...lanes,
      lanes: lanes.lanes.map((lane) => {
        if (lane.participant === "shop") {
          return {
            ...lane,
            nodes: lane.nodes.filter((id) => id !== "a-cancel"),
          };
        }

        return lane.participant === "customer"
          ? { ...lane, nodes: [...lane.nodes, "a-cancel"] }
          : lane;
      }),
    };
    const diff = diffSwimlane(model, edited);

    expect(diff).toEqual({
      elements: [
        {
          kind: "relaned",
          element: "a-cancel",
          from: "shop",
          to: "customer",
          inferred: false,
        },
      ],
      transitions: [],
      events: [],
    });
    expect(handoffs(applyModelDiff(model, diff))).toContainEqual({
      transition: "t6",
      from: "shop",
      to: "customer",
    });
  });

  it("gives a step added to a lane that lane's actor", () => {
    const diff = diffSwimlane(model, {
      ...lanes,
      nodes: [
        ...lanes.nodes,
        { id: "a-refund", label: "Refund", shape: "process" },
      ],
      lanes: lanes.lanes.map((lane) =>
        lane.participant === "provider"
          ? { ...lane, nodes: [...lane.nodes, "a-refund"] }
          : lane,
      ),
    });

    expect(diff.elements).toEqual([
      {
        kind: "added",
        element: {
          kind: "activity",
          id: "a-refund",
          label: "Refund",
          actor: "provider",
        },
        inferred: false,
      },
    ]);
  });

  it("refuses a lane for an entity, which cannot act", () => {
    expect(() =>
      diffSwimlane(model, {
        ...lanes,
        lanes: [
          ...lanes.lanes,
          { participant: "order", label: "Order", nodes: [] },
        ],
      }),
    ).toThrow(/cannot act/u);
  });
});

describe("diffStateMachine on the order's state machine", () => {
  const machine = toStateMachine(model, "order");
  const edited = {
    subject: "order",
    states: [
      ...machine.states.map((state) =>
        state.id === "a-pack" ? { ...state, label: "Packed" } : state,
      ),
      { id: "s-delivered", label: "Delivered", role: "state" as const },
    ],
    transitions: [
      ...machine.transitions
        .filter((transition) => transition.target !== "a-cancel")
        .map((transition) =>
          transition.target === "a-pack"
            ? { ...transition, guard: "approved" }
            : transition,
        ),
      {
        source: "a-pack",
        target: "s-delivered",
        event: "ev-authorised",
        transitions: ["t9"],
      },
    ],
  };

  it("maps single transitions back with certainty and marks what acts on a folded decision's branch as inferred", () => {
    expect(diffStateMachine(model, edited)).toEqual({
      elements: [
        {
          kind: "renamed",
          element: "a-pack",
          from: "Pack and ship",
          to: "Packed",
          inferred: false,
        },
        {
          kind: "added",
          element: { kind: "state", id: "s-delivered", label: "Delivered" },
          inferred: false,
        },
      ],
      transitions: [
        { kind: "removed", transition: "t6", inferred: true },
        {
          kind: "changed",
          field: "guard",
          transition: "t5",
          from: "authorised",
          to: "approved",
          inferred: true,
        },
        {
          kind: "added",
          transition: {
            id: "t9",
            source: "a-pack",
            target: "s-delivered",
            trigger: "ev-authorised",
          },
          inferred: false,
        },
      ],
      events: [],
    });
  });

  it("applies once confirmed, giving the edited machine", () => {
    const diff = diffStateMachine(model, edited);

    expect(() => applyModelDiff(model, diff)).toThrow(UnconfirmedChangeError);

    const applied = applyModelDiff(model, confirmAll(diff));
    const projected = toStateMachine(applied, "order");

    expect(projected.states).toEqual(edited.states);
    expect(projected.transitions).toContainEqual({
      source: "a-authorise",
      target: "a-pack",
      event: "ev-authorised",
      guard: "approved",
      effect: "act-pack",
      transitions: ["t4", "t5"],
      through: ["d-authorised"],
    });
    expect(
      projected.transitions.map((transition) => transition.target),
    ).not.toContain("a-cancel");
  });

  it("refuses an effect edit where the effect is the target activity's action", () => {
    expect(() =>
      diffStateMachine(model, {
        ...machine,
        transitions: machine.transitions.map((transition) =>
          transition.target === "a-request"
            ? { ...transition, effect: "act-pack" }
            : transition,
        ),
      }),
    ).toThrow(/action of "a-request"/u);
  });
});

describe("diffSequence on the shipped path", () => {
  const diagram = toSequence(model, shipped);

  it("infers a new step from an inserted message and rewires the step after it, and renames what labels came from with certainty", () => {
    const edited = {
      messages: diagram.messages.flatMap((message) => {
        if (message.transition === "t2") {
          return [
            message,
            {
              transition: "tq",
              from: "shop",
              to: "shop",
              label: "Check stock",
              element: "a-stock",
            },
          ];
        }
        if (message.transition === "t4") {
          return [{ ...message, label: "Authorisation result" }];
        }

        return message.transition === "t5"
          ? [{ ...message, label: "payment approved" }]
          : [message];
      }),
    };
    const diff = diffSequence(model, shipped, edited);

    expect(diff).toEqual({
      elements: [
        {
          kind: "added",
          element: {
            kind: "activity",
            id: "a-stock",
            label: "Check stock",
            actor: "shop",
          },
          inferred: true,
        },
        {
          kind: "renamed",
          element: "d-authorised",
          from: "Payment authorised?",
          to: "Authorisation result",
          inferred: false,
        },
      ],
      transitions: [
        {
          kind: "added",
          transition: { id: "tq", source: "a-request", target: "a-stock" },
          inferred: true,
        },
        {
          kind: "rewired",
          transition: "t3",
          from: { source: "a-request", target: "a-authorise" },
          to: { source: "a-stock", target: "a-authorise" },
          inferred: true,
        },
      ],
      events: [
        {
          kind: "renamed",
          event: "ev-authorised",
          from: "payment authorised",
          to: "payment approved",
          inferred: false,
        },
      ],
    });
    expect(() => applyModelDiff(model, diff)).toThrow(UnconfirmedChangeError);

    const applied = applyModelDiff(model, confirmAll(diff));

    expect(validate(applied)).toEqual([]);
    // The new step arrives at an activity, so the projection names no message element for it.
    const drawn = ({
      transition,
      from,
      to,
      label,
    }: SequenceMessage<OpenIds>): readonly string[] => [
      transition,
      from,
      to,
      label,
    ];

    expect(
      toSequence(applied, [
        "t1",
        "t2",
        "tq",
        "t3",
        "t4",
        "t5",
        "t7",
      ]).messages.map(drawn),
    ).toEqual(edited.messages.map(drawn));
  });

  it("infers that a dropped message removes its step and a moved receiver relanes its target", () => {
    const diff = diffSequence(model, shipped, {
      messages: diagram.messages
        .filter((message) => message.transition !== "t5")
        .map((message) =>
          message.transition === "t2"
            ? { ...message, to: "provider" }
            : message,
        ),
    });

    expect(diff).toEqual({
      elements: [
        {
          kind: "relaned",
          element: "a-request",
          from: "shop",
          to: "provider",
          inferred: true,
        },
      ],
      transitions: [{ kind: "removed", transition: "t5", inferred: true }],
      events: [],
    });
  });

  it("readdresses a message element with certainty", () => {
    const path = ["t1", "t2", "t3a", "t3b", "t4", "t5", "t7a", "t7b"] as const;
    const withMessages = toSequence(orderWithMessages, path);
    const diff = diffSequence(orderWithMessages, path, {
      messages: withMessages.messages.map((message) =>
        message.element === "m-dispatch"
          ? { ...message, from: "provider" }
          : message,
      ),
    });

    expect(diff.elements).toEqual([
      {
        kind: "readdressed",
        element: "m-dispatch",
        from: { from: "shop", to: "customer" },
        to: { from: "provider", to: "customer" },
        inferred: false,
      },
    ]);
  });

  it("refuses a new message that does not name the element it arrives at", () => {
    expect(() =>
      diffSequence(model, shipped, {
        messages: [
          ...diagram.messages,
          { transition: "tx", from: "shop", to: "customer", label: "Thanks" },
        ],
      }),
    ).toThrow(/must name the element/u);
  });
});
