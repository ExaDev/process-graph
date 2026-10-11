import type { Status, StatusRule } from "@exadev/process-graph-domain";
import type {
  Element,
  IdSpace,
  PseudoRole,
} from "@exadev/process-graph-schema";

/** The text each status is shown with, so every component names a status the same way. */
export const statusLabels: Readonly<Record<Status, string>> = {
  done: "Done",
  ready: "Ready",
  blocked: "Blocked",
  skipped: "Skipped",
  unknown: "Unknown",
};

/** One sentence per status rule, saying why an element has the status that rule decided. */
export const ruleDescriptions: Readonly<Record<StatusRule, string>> = {
  "overlay-done": "The run reports it done.",
  "overlay-unknown": "The run reports its state as unknown.",
  "unknown-need":
    "Something it needs has an unknown state or an undecided condition.",
  "all-cut": "Every path into it was cut, so it will not run.",
  "needs-met": "Everything it needs is done.",
  waiting: "It is still waiting on unfinished work.",
};

/** The labels the projections give pseudo-states, which carry no label of their own. */
const pseudoLabels: Readonly<Record<PseudoRole, string>> = {
  initial: "Start",
  final: "End",
  fork: "Fork",
  join: "Join",
  history: "History",
};

/**
 * The text an element is shown with: its own label, or for a pseudo-state the name of its role.
 * @param element - The element to name.
 * @returns The element's display label.
 */
export const elementLabel = <I extends IdSpace>(
  element: Element<I["element"], I>,
): string =>
  element.kind === "pseudo" ? pseudoLabels[element.role] : element.label;
