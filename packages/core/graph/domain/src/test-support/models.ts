import { defineModel } from "@exadev/process-graph-schema";
import { elementStatusKey } from "../facts.ts";
import { fails, holds } from "./conditions.ts";

const team = [{ id: "team", label: "Team", kind: "role" }] as const;

/** A chain a, b, c. */
export const chain = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A", actor: "team" },
    { kind: "activity", id: "b", label: "B", actor: "team" },
    { kind: "activity", id: "c", label: "C", actor: "team" },
  ],
  transitions: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
  ],
  fragments: [],
  projections: [],
});

/** A diamond: a, then b and c, then d. */
export const diamond = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A", actor: "team" },
    { kind: "activity", id: "b", label: "B", actor: "team" },
    { kind: "activity", id: "c", label: "C", actor: "team" },
    { kind: "activity", id: "d", label: "D", actor: "team" },
  ],
  transitions: [
    { id: "ab", source: "a", target: "b" },
    { id: "ac", source: "a", target: "c" },
    { id: "bd", source: "b", target: "d" },
    { id: "cd", source: "c", target: "d" },
  ],
  fragments: [],
  projections: [],
});

/** Write, review and publish, where a failed review (decision) sends the work back to write. */
export const retryLoop = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "write", label: "Write", actor: "team" },
    { kind: "decision", id: "review", label: "Review passed?", actor: "team" },
    { kind: "activity", id: "publish", label: "Publish", actor: "team" },
  ],
  transitions: [
    { id: "to-review", source: "write", target: "review" },
    {
      id: "pass",
      source: "review",
      target: "publish",
      condition: holds("passed"),
    },
    {
      id: "retry",
      source: "review",
      target: "write",
      condition: fails("passed"),
    },
  ],
  fragments: [],
  projections: [],
});

/** Two activities that wait on each other with no decision between them. */
export const plainCycle = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "x", label: "X", actor: "team" },
    { kind: "activity", id: "y", label: "Y", actor: "team" },
  ],
  transitions: [
    { id: "xy", source: "x", target: "y" },
    { id: "yx", source: "y", target: "x" },
  ],
  fragments: [],
  projections: [],
});

/** Triage, then a decision on `approved` into accept or reject, then a merge activity both reach. */
export const approval = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "triage", label: "Triage", actor: "team" },
    { kind: "decision", id: "choose", label: "Approved?", actor: "team" },
    { kind: "activity", id: "accept", label: "Accept", actor: "team" },
    { kind: "activity", id: "reject", label: "Reject", actor: "team" },
    { kind: "activity", id: "notify", label: "Notify", actor: "team" },
    { kind: "activity", id: "close", label: "Close", actor: "team" },
  ],
  transitions: [
    { id: "t-choose", source: "triage", target: "choose" },
    {
      id: "t-accept",
      source: "choose",
      target: "accept",
      condition: holds("approved"),
    },
    {
      id: "t-reject",
      source: "choose",
      target: "reject",
      condition: fails("approved"),
    },
    { id: "t-notify", source: "accept", target: "notify" },
    { id: "t-close-a", source: "notify", target: "close" },
    { id: "t-close-r", source: "reject", target: "close" },
  ],
  fragments: [],
  projections: [],
});

/** A fork into b and c, a join, then e. Neither branch is conditional. */
export const forkJoin = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A", actor: "team" },
    { kind: "pseudo", id: "fork", role: "fork" },
    { kind: "activity", id: "b", label: "B", actor: "team" },
    { kind: "activity", id: "c", label: "C", actor: "team" },
    { kind: "pseudo", id: "join", role: "join" },
    { kind: "activity", id: "e", label: "E", actor: "team" },
  ],
  transitions: [
    { id: "a-fork", source: "a", target: "fork" },
    { id: "fork-b", source: "fork", target: "b" },
    { id: "fork-c", source: "fork", target: "c" },
    { id: "b-join", source: "b", target: "join" },
    { id: "c-join", source: "c", target: "join" },
    { id: "join-e", source: "join", target: "e" },
  ],
  fragments: [],
  projections: [],
});

/** A decision into b or c, both of which reach a join, then e. */
export const branchJoin = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A", actor: "team" },
    { kind: "decision", id: "pick", label: "Fast path?", actor: "team" },
    { kind: "activity", id: "b", label: "B", actor: "team" },
    { kind: "activity", id: "c", label: "C", actor: "team" },
    { kind: "pseudo", id: "join", role: "join" },
    { kind: "activity", id: "e", label: "E", actor: "team" },
  ],
  transitions: [
    { id: "a-pick", source: "a", target: "pick" },
    { id: "pick-b", source: "pick", target: "b", condition: holds("fast") },
    { id: "pick-c", source: "pick", target: "c", condition: fails("fast") },
    { id: "b-join", source: "b", target: "join" },
    { id: "c-join", source: "c", target: "join" },
    { id: "join-e", source: "join", target: "e" },
  ],
  fragments: [],
  projections: [],
});

/** Build needs a spec nobody produces and makes a bundle; ship consumes the bundle and makes the release deliverable. No transitions: control is the artefacts alone. */
export const pipeline = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [
    { id: "spec", name: "Specification" },
    { id: "bundle", name: "Bundle" },
    { id: "release", name: "Release", deliverable: true },
  ],
  elements: [
    {
      kind: "activity",
      id: "build",
      label: "Build",
      actor: "team",
      consumes: ["spec"],
      produces: ["bundle"],
    },
    {
      kind: "activity",
      id: "ship",
      label: "Ship",
      actor: "team",
      consumes: ["bundle"],
      produces: ["release"],
    },
  ],
  transitions: [],
  fragments: [],
  projections: [],
});

/** A decision whose branch reads another element's run state through the reserved key. */
export const reviewGate = defineModel({
  participants: team,
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "audit", label: "Audit", actor: "team" },
    { kind: "activity", id: "start", label: "Start", actor: "team" },
    { kind: "decision", id: "gate", label: "Audit done?", actor: "team" },
    { kind: "activity", id: "proceed", label: "Proceed", actor: "team" },
  ],
  transitions: [
    { id: "start-gate", source: "start", target: "gate" },
    {
      id: "gate-proceed",
      source: "gate",
      target: "proceed",
      condition: {
        kind: "textCompare",
        op: "equals",
        left: { kind: "reference", key: elementStatusKey("audit") },
        right: { kind: "textLiteral", value: "done" },
      },
    },
  ],
  fragments: [],
  projections: [],
});
