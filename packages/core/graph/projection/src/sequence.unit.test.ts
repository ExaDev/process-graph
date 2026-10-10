import {
  defineModel,
  type Model,
  type OpenIds,
} from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { toSequence, type SequenceItem } from "./sequence.ts";

/**
 * A checkout with a payment retry loop and an authorised or declined branch. Messages arrive at the element named in their transition, so each fragment below is defined by the elements its messages arrive at.
 */
const checkout = defineModel({
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    { kind: "activity", id: "a-cart", label: "Fill cart", actor: "customer" },
    { kind: "activity", id: "a-pay", label: "Take payment", actor: "shop" },
    { kind: "decision", id: "d-ok", label: "Paid?", actor: "shop" },
    {
      kind: "activity",
      id: "a-retry",
      label: "Re-enter card",
      actor: "customer",
    },
    { kind: "activity", id: "a-ship", label: "Ship", actor: "shop" },
    { kind: "activity", id: "a-cancel", label: "Cancel", actor: "shop" },
    { kind: "pseudo", id: "end", role: "final" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "a-cart" },
    { id: "t2", source: "a-cart", target: "a-pay" },
    { id: "t3", source: "a-pay", target: "d-ok" },
    { id: "t4", source: "d-ok", target: "a-retry", guard: "declined" },
    { id: "t5", source: "a-retry", target: "a-pay" },
    { id: "t6", source: "d-ok", target: "a-ship", guard: "authorised" },
    { id: "t7", source: "a-ship", target: "end" },
    { id: "t8", source: "d-ok", target: "a-cancel", guard: "gave up" },
  ],
  fragments: [],
  projections: [],
});

/** The checkout with authored fragments, as a runtime model so the fragments can name any element. */
const withFragments = (
  fragments: Model<OpenIds>["fragments"],
): Model<OpenIds> => ({ ...checkout, fragments });

const message = (
  transition: string,
  from: string,
  to: string,
  label: string,
): SequenceItem<OpenIds> => ({
  kind: "message",
  message: { transition, from, to, label },
});

const retried = ["t2", "t3", "t4", "t5", "t3", "t6", "t7"];

const paymentLoop = {
  id: "f-loop",
  operator: "loop",
  operands: [{ guard: "until paid", body: ["a-pay", "d-ok", "a-retry"] }],
} as const;

const outcome = {
  id: "f-alt",
  operator: "alt",
  operands: [
    { guard: "authorised", body: ["a-ship"] },
    { guard: "declined", body: ["a-cancel"] },
  ],
} as const;

describe("toSequence without fragments", () => {
  it("lists every message as a message item in scenario order", () => {
    const diagram = toSequence(withFragments([]), ["t2", "t3", "t6"]);

    expect(diagram.items).toEqual([
      message("t2", "customer", "shop", "Take payment"),
      message("t3", "shop", "shop", "Paid?"),
      message("t6", "shop", "shop", "Ship"),
    ]);
    expect(diagram.messages.map((entry) => entry.transition)).toEqual([
      "t2",
      "t3",
      "t6",
    ]);
  });
});

describe("toSequence with authored fragments", () => {
  it("wraps the messages a loop covers and leaves the rest outside", () => {
    const diagram = toSequence(withFragments([paymentLoop]), retried);

    expect(diagram.items).toEqual([
      {
        kind: "fragment",
        fragment: "f-loop",
        operator: "loop",
        operands: [
          {
            guard: "until paid",
            items: [
              message("t2", "customer", "shop", "Take payment"),
              message("t3", "shop", "shop", "Paid?"),
              message("t4", "shop", "customer", "Re-enter card"),
              message("t5", "customer", "shop", "Take payment"),
              message("t3", "shop", "shop", "Paid?"),
            ],
          },
        ],
      },
      message("t6", "shop", "shop", "Ship"),
    ]);
    expect(diagram.loss).not.toContainEqual(
      expect.objectContaining({ kind: "fragments" }),
    );
  });

  it("draws only the alt operand the scenario takes", () => {
    const shipped = toSequence(withFragments([outcome]), ["t2", "t3", "t6"]);
    const cancelled = toSequence(withFragments([outcome]), ["t2", "t3", "t8"]);

    expect(shipped.items.at(-1)).toEqual({
      kind: "fragment",
      fragment: "f-alt",
      operator: "alt",
      operands: [
        {
          guard: "authorised",
          items: [message("t6", "shop", "shop", "Ship")],
        },
      ],
    });
    expect(cancelled.items.at(-1)).toEqual({
      kind: "fragment",
      fragment: "f-alt",
      operator: "alt",
      operands: [
        {
          guard: "declined",
          items: [message("t8", "shop", "shop", "Cancel")],
        },
      ],
    });
  });

  it("emits a loop followed by an alt, keeping messages flat in `messages`", () => {
    const diagram = toSequence(withFragments([paymentLoop, outcome]), retried);

    expect(diagram.items.map((item) => item.kind)).toEqual([
      "fragment",
      "fragment",
    ]);
    expect(diagram.messages.map((entry) => entry.transition)).toEqual([
      "t2",
      "t3",
      "t4",
      "t5",
      "t3",
      "t6",
    ]);
  });

  it("nests a fragment inside the operand that holds all its messages", () => {
    const optional = {
      id: "f-opt",
      operator: "opt",
      operands: [{ body: ["a-pay", "d-ok", "a-retry", "a-ship"] }],
    } as const;
    const diagram = toSequence(withFragments([paymentLoop, optional]), retried);

    expect(diagram.items).toEqual([
      {
        kind: "fragment",
        fragment: "f-opt",
        operator: "opt",
        operands: [
          {
            items: [
              {
                kind: "fragment",
                fragment: "f-loop",
                operator: "loop",
                operands: [
                  {
                    guard: "until paid",
                    items: [
                      message("t2", "customer", "shop", "Take payment"),
                      message("t3", "shop", "shop", "Paid?"),
                      message("t4", "shop", "customer", "Re-enter card"),
                      message("t5", "customer", "shop", "Take payment"),
                      message("t3", "shop", "shop", "Paid?"),
                    ],
                  },
                ],
              },
              message("t6", "shop", "shop", "Ship"),
            ],
          },
        ],
      },
    ]);
  });

  it("does not invent a fragment for one whose messages are interleaved with others", () => {
    const split = {
      id: "f-split",
      operator: "opt",
      operands: [{ body: ["a-pay", "a-ship"] }],
    } as const;
    const diagram = toSequence(withFragments([split]), ["t2", "t3", "t6"]);

    expect(diagram.items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "message",
    ]);
    expect(diagram.loss).toContainEqual({
      kind: "fragments",
      fragments: ["f-split"],
    });
  });

  it("does not draw a fragment whose elements are off the scenario path", () => {
    const offPath = {
      id: "f-off",
      operator: "opt",
      operands: [{ body: ["a-cancel"] }],
    } as const;
    const diagram = toSequence(withFragments([offPath]), ["t2", "t3", "t6"]);

    expect(diagram.items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "message",
    ]);
    expect(diagram.loss).toContainEqual({
      kind: "fragments",
      fragments: ["f-off"],
    });
  });

  it("does not draw a fragment that overlaps another without nesting", () => {
    const left = {
      id: "f-left",
      operator: "opt",
      operands: [{ body: ["a-pay", "d-ok"] }],
    } as const;
    const right = {
      id: "f-right",
      operator: "opt",
      operands: [{ body: ["d-ok", "a-retry"] }],
    } as const;
    const diagram = toSequence(withFragments([left, right]), [
      "t2",
      "t3",
      "t4",
    ]);

    const drawn = diagram.items.flatMap((item) =>
      item.kind === "fragment" ? [item.fragment] : [],
    );

    expect(drawn).toEqual(["f-left"]);
    expect(diagram.loss).toContainEqual({
      kind: "fragments",
      fragments: ["f-right"],
    });
  });
});
