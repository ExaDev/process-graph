/** The derived states of an element, in the order the derivation considers them. */
export const statuses = [
  "done",
  "unknown",
  "skipped",
  "ready",
  "blocked",
] as const;

/**
 * Where an element stands in a run, derived from the model, the run overlay and the facts, never stored.
 *
 * - `done`: finished, as reported by the overlay or, for a pure control element, derived.
 * - `unknown`: cannot be told apart, because the overlay says so, a need is unknown, or a condition on an incoming transition is indeterminate.
 * - `skipped`: every incoming path is cut, so the element will not run.
 * - `ready`: not done, with every live need done and every consumed artefact produced or provided.
 * - `blocked`: not done and still waiting.
 */
export type Status = (typeof statuses)[number];

/**
 * What a transition's `condition` evaluates to: `taken`, `not-taken`, or `indeterminate` when facts the condition reads are missing, so both outcomes stay possible. A transition without a condition is always `taken`.
 */
export type Branch = "taken" | "not-taken" | "indeterminate";
