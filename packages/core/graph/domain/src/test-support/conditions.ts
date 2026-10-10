import type { PredicateNode } from "trilean";
import { artefactKey, type Facts } from "../facts.ts";

/** A condition that holds when the boolean fact under `key` is true. */
export const holds = (key: string): PredicateNode => ({
  kind: "compare",
  op: "eq",
  left: { kind: "reference", key },
  right: { kind: "booleanLiteral", value: true },
});

/** The negation of `holds`: definitely false when the fact is true, and indeterminate when the fact is missing. */
export const fails = (key: string): PredicateNode => ({
  kind: "not",
  operand: holds(key),
});

/**
 * A facts port answering the given string keys with booleans, reporting each artefact in `provided` as provided, and answering every other key as not found.
 */
export const factsOf =
  (
    values: Readonly<Record<string, boolean>>,
    provided: readonly string[] = [],
  ): Facts =>
  (key) => {
    const value =
      typeof key === "string"
        ? values[key]
        : provided.some(
              (id) => JSON.stringify(key) === JSON.stringify(artefactKey(id)),
            )
          ? true
          : undefined;

    return value === undefined
      ? { found: false }
      : { found: true, value: { kind: "boolean", value } };
  };

/** A facts port that knows nothing, so every condition reading it is indeterminate. */
export const noFacts: Facts = () => ({ found: false });
