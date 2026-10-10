import type { Model, OpenIds } from "@exadev/process-graph-schema";

/**
 * A model that uses every field the model schema has, each optional field present on some record and absent on another, so a store that drops, renames or reorders anything fails the round trip.
 */
export const everyFieldModel: Model<OpenIds> = {
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [
    { id: "placed", name: "Order placed", payload: { total: "number" } },
    { id: "paid", name: "Payment received" },
  ],
  actions: [
    { id: "notify", name: "Notify customer" },
    { id: "log", name: "Write audit log" },
  ],
  artefacts: [
    { id: "basket", name: "Basket" },
    { id: "invoice", name: "Invoice", deliverable: true },
    { id: "receipt", name: "Receipt", deliverable: false },
  ],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    {
      kind: "activity",
      id: "github:shop/orders#1",
      label: "Place order",
      actor: "customer",
      action: "notify",
      source: "github:shop/orders#1",
      affects: ["order"],
      consumes: ["basket"],
      produces: ["invoice"],
      extensions: { bpmn: { pool: "Customer", lane: 1, marker: null } },
    },
    { kind: "decision", id: "approve", label: "Approve?", actor: "shop" },
    {
      kind: "state",
      id: "pending",
      label: "Pending",
      parent: "start",
      entry: "log",
      exit: "notify",
    },
    { kind: "state", id: "closed", label: "Closed" },
    {
      kind: "message",
      id: "confirm",
      label: "Confirm",
      from: "shop",
      to: "customer",
      mode: "async",
      event: "paid",
    },
    {
      kind: "message",
      id: "ack",
      label: "Acknowledge",
      from: "customer",
      to: "shop",
      mode: "reply",
    },
    { kind: "activity", id: "ship", label: "Ship" },
    { kind: "pseudo", id: "end", role: "final", parent: "pending" },
  ],
  transitions: [
    { id: "t-start", source: "start", target: "github:shop/orders#1" },
    {
      id: "t-review",
      source: "github:shop/orders#1",
      target: "approve",
      trigger: "placed",
      effect: "log",
    },
    {
      id: "t-yes",
      source: "approve",
      target: "ship",
      guard: "approved",
      condition: {
        kind: "compare",
        op: "eq",
        left: { kind: "reference", key: { $fact: "approved" } },
        right: { kind: "booleanLiteral", value: true },
      },
    },
    { id: "t-no", source: "approve", target: "closed", guard: "rejected" },
    { id: "t-end", source: "ship", target: "end" },
  ],
  fragments: [
    {
      id: "decide",
      operator: "alt",
      operands: [{ guard: "approved", body: ["ship"] }, { body: ["closed"] }],
    },
    { id: "chat", operator: "par", operands: [] },
  ],
  projections: [
    { id: "flow", notation: "flowchart" },
    { id: "lanes", notation: "swimlane" },
    { id: "lifecycle", notation: "stateMachine", subject: "order" },
    { id: "happy", notation: "sequence", scenario: ["t-review", "t-yes"] },
  ],
  views: {
    flowchart: { start: { x: 0, y: 0 }, ship: { x: 120.5, y: -40 } },
    sequence: {},
  },
};

/**
 * A model for the structural queries: a done first step, a chain through a decision whose retry edge loops back, a join waiting on two branches, and an unrelated step.
 *
 * `a` (done) leads to `b`, `b` to `c`, `c` to the decision `d`, which either approves into `e` or retries back to `b` (a loop edge, so it is no dependency). `e` and the independent `x` meet at the join `j`, which leads to `f`.
 */
export const queryModel: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A", actor: "team" },
    { kind: "activity", id: "b", label: "B", actor: "team" },
    { kind: "activity", id: "c", label: "C", actor: "team" },
    { kind: "decision", id: "d", label: "D?" },
    { kind: "activity", id: "e", label: "E", actor: "team" },
    { kind: "activity", id: "x", label: "X", actor: "team" },
    { kind: "pseudo", id: "j", role: "join" },
    { kind: "activity", id: "f", label: "F", actor: "team" },
  ],
  transitions: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
    { id: "cd", source: "c", target: "d" },
    { id: "de", source: "d", target: "e", guard: "approved" },
    { id: "db", source: "d", target: "b", guard: "retry" },
    { id: "ej", source: "e", target: "j" },
    { id: "xj", source: "x", target: "j" },
    { id: "jf", source: "j", target: "f" },
  ],
  fragments: [],
  projections: [],
};
