import type { JsonValue, Resolution, SyncResolvers } from "trilean";
import { createSyncEvaluator } from "trilean";
import type { IdSpace, Model, Overlay } from "@exadev/process-graph-schema";
import type { Branch } from "./status.ts";

/**
 * The injected source of facts a condition reads: an opaque, JSON-valued key in, a found or not-found value out (trilean's `Resolution`). A key the port cannot answer is `{ found: false }`, which makes any condition that depends on it indeterminate, never false.
 *
 * Keys of the reserved shape built by `elementStatusKey` are answered by this package from the overlay and never reach the port. The port is asked keys of the shape built by `artefactKey` to learn which input artefacts are provided; it should answer every other key it does not know with `{ found: false }`.
 */
export type Facts = (key: JsonValue) => Resolution;

/** The only field of a reserved key. Keys that carry it are resolved from the overlay, so a `Facts` implementation must not use it. */
const elementField = "$element";

/**
 * Builds the reserved key that reads another element's run state inside a condition. It resolves to the text `"done"` or `"open"`, and is not found (so the condition is indeterminate) when the overlay says `"unknown"` or the id is not an element of the model.
 *
 * The value is the overlay's own state, not the derived status: a condition therefore never depends on the derivation that evaluates it, and cannot form a cycle.
 * @param id - The element whose state is read.
 * @returns A key to put in a trilean `reference` node.
 */
export const elementStatusKey = (id: string): JsonValue => ({
  [elementField]: id,
});

/** The only field of the key the package puts to the port to ask whether an input artefact is provided. */
const artefactField = "$artefact";

/**
 * Builds the key the package asks the facts port when it needs to know whether an artefact has been provided from outside the process. An artefact is provided exactly when the port answers `{ found: true }` with the boolean `true`; a not-found or `false` answer means it is not.
 *
 * A provided artefact satisfies every consumer, whether or not an activity also produces it.
 * @param id - The artefact.
 * @returns The key the port is asked.
 */
export const artefactKey = (id: string): JsonValue => ({
  [artefactField]: id,
});

/**
 * Whether the facts port reports an artefact as provided.
 * @param facts - The injected source of facts.
 * @param id - The artefact.
 */
export const isProvided = (facts: Facts, id: string): boolean => {
  const answer = facts(artefactKey(id));

  return answer.found && answer.value.kind === "boolean" && answer.value.value;
};

/**
 * Thrown when a condition uses a node whose evaluation needs a table or a collection from the facts port, which answers single keys only.
 */
export class UnsupportedConditionError extends Error {
  /** The kind of reference the condition used. */
  readonly reference: "lookup" | "collection";

  /**
   * @param reference - The unsupported kind of reference.
   */
  constructor(reference: "lookup" | "collection") {
    super(
      `A condition uses a ${reference} reference, which the Facts port does not answer: it resolves single keys only`,
    );
    this.name = "UnsupportedConditionError";
    this.reference = reference;
  }
}

const evaluator = createSyncEvaluator({});

const isRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Evaluates every transition's condition.
 *
 * A definite true is `taken`, a definite false is `not-taken` and an indeterminate result is `indeterminate`. A transition without a condition is `taken`. Conditions are evaluated for every transition regardless of the state of its source.
 * @param model - The model whose transitions are evaluated.
 * @param overlay - Run state, read by `elementStatusKey` references.
 * @param facts - The injected source of facts.
 * @returns The outcome of every transition, in transition order.
 * @throws UnsupportedConditionError when a condition contains a `lookup`, `some`, `every` or fold node.
 */
export const evaluateBranches = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
): ReadonlyMap<I["transition"], Branch> => {
  const elementIds = new Set<string>(model.elements.map(({ id }) => id));
  const overlayOf = new Map<string, string>(Object.entries(overlay));
  const resolvers: SyncResolvers = {
    resolveValue: (key) => {
      if (!isRecord(key) || !(elementField in key)) {
        return facts(key);
      }
      const id = key[elementField];
      if (typeof id !== "string" || !elementIds.has(id)) {
        return { found: false };
      }
      const state = overlayOf.get(id);
      if (state === "unknown") {
        return { found: false };
      }

      return {
        found: true,
        value: { kind: "text", value: state === "done" ? "done" : "open" },
      };
    },
    resolveLookup: () => {
      throw new UnsupportedConditionError("lookup");
    },
    resolveCollection: () => {
      throw new UnsupportedConditionError("collection");
    },
  };

  return new Map(
    model.transitions.map(({ id, condition }) => {
      if (condition === undefined) {
        return [id, "taken"];
      }
      const result = evaluator.evaluatePredicate(
        condition,
        undefined,
        resolvers,
      );
      if (result.status === "indeterminate") {
        return [id, "indeterminate"];
      }

      return [id, result.value ? "taken" : "not-taken"];
    }),
  );
};
