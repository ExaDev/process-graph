import { defineModel } from "@exadev/process-graph-schema";

/** The order process from the doc, with every reference checked at compile time. */
export const order = defineModel({
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "provider", label: "Payment provider", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [
    { id: "ev-submitted", name: "order submitted" },
    { id: "ev-authorised", name: "payment authorised" },
    { id: "ev-declined", name: "payment declined" },
  ],
  actions: [
    { id: "act-request", name: "request payment" },
    { id: "act-pack", name: "pack and ship" },
    { id: "act-cancel", name: "cancel order and notify" },
  ],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    {
      kind: "activity",
      id: "a-submit",
      label: "Submit order",
      actor: "customer",
    },
    {
      kind: "activity",
      id: "a-request",
      label: "Request payment",
      actor: "shop",
      action: "act-request",
    },
    {
      kind: "activity",
      id: "a-authorise",
      label: "Authorise or decline",
      actor: "provider",
    },
    {
      kind: "decision",
      id: "d-authorised",
      label: "Payment authorised?",
      actor: "shop",
    },
    {
      kind: "activity",
      id: "a-pack",
      label: "Pack and ship",
      actor: "shop",
      action: "act-pack",
    },
    {
      kind: "activity",
      id: "a-cancel",
      label: "Cancel order and notify",
      actor: "shop",
      action: "act-cancel",
    },
    { kind: "pseudo", id: "end", role: "final" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "a-submit", trigger: "ev-submitted" },
    { id: "t2", source: "a-submit", target: "a-request" },
    { id: "t3", source: "a-request", target: "a-authorise" },
    { id: "t4", source: "a-authorise", target: "d-authorised" },
    {
      id: "t5",
      source: "d-authorised",
      target: "a-pack",
      guard: "authorised",
      trigger: "ev-authorised",
    },
    {
      id: "t6",
      source: "d-authorised",
      target: "a-cancel",
      guard: "declined",
      trigger: "ev-declined",
    },
    { id: "t7", source: "a-pack", target: "end" },
    { id: "t8", source: "a-cancel", target: "end" },
  ],
  fragments: [],
  projections: [
    { id: "p-flow", notation: "flowchart" },
    { id: "p-lanes", notation: "swimlane" },
    { id: "p-state", notation: "stateMachine", subject: "order" },
    {
      id: "p-seq",
      notation: "sequence",
      scenario: ["t1", "t2", "t3", "t4", "t5", "t7"],
    },
  ],
  views: {
    flowchart: { "a-request": { x: 306, y: 100 } },
  },
});
