import type { Status } from "@exadev/process-graph-domain";
import type { StyleRule } from "@vanilla-extract/css";
import { vars } from "./theme.css.ts";

/**
 * One style per status, built by `rule` from the status's colour, so every status-coloured part covers every status.
 * @param rule - The style for one status colour.
 * @returns The style of each status.
 */
export const byStatus = (
  rule: (colour: string) => StyleRule,
): Record<Status, StyleRule> => ({
  done: rule(vars.colour.status.done),
  ready: rule(vars.colour.status.ready),
  blocked: rule(vars.colour.status.blocked),
  skipped: rule(vars.colour.status.skipped),
  unknown: rule(vars.colour.status.unknown),
});

/**
 * Selectors that colour an element by the status in its `data-status` attribute, for a part whose status the styled component cannot see, such as a legend's swatches.
 * @param rule - The style for one status colour.
 * @returns A `selectors` block with one entry per status.
 */
export const byStatusAttribute = (
  rule: (colour: string) => StyleRule,
): Record<string, StyleRule> =>
  Object.fromEntries(
    Object.entries(byStatus(rule)).map(([status, style]) => [
      `&[data-status="${status}"]`,
      style,
    ]),
  );
