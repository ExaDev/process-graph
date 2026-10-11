import type {
  ComputedValue,
  ExpressionNode,
  JsonValue,
  PredicateNode,
  Resolution,
  SyncResolvers,
} from "trilean";
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
 * What is known from outside the process about one run, as plain data a store can keep: which artefacts are provided, and the values of named facts that conditions read.
 *
 * Each part is three-valued by presence. An artefact mapped to `true` is provided and one mapped to `false` is known not to be; an artefact the record does not name is unknown, which `isProvided` treats as not provided but a condition reading `artefactKey` sees as indeterminate. A named fact holds a trilean value; a name the record does not hold is unknown, so a condition reading it is indeterminate.
 */
export interface FactRecord {
  /** The artefacts whose provision is known, by artefact id. */
  readonly artefacts: Readonly<Record<string, boolean>>;
  /** The values of named facts, by the name a condition's `reference` node gives as its key. */
  readonly values: Readonly<Record<string, ComputedValue>>;
}

/** A record that knows nothing: no artefact is provided and every named fact is unknown. */
export const emptyFactRecord: FactRecord = { artefacts: {}, values: {} };

const isRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The artefact id an `artefactKey` key names, or `undefined` for any other key. */
const artefactOf = (key: JsonValue): string | undefined => {
  if (!isRecord(key) || Object.keys(key).length !== 1) {
    return undefined;
  }
  const id = key[artefactField];

  return typeof id === "string" ? id : undefined;
};

/**
 * Adapts a fact record to the `Facts` port. A string key is a named fact, answered with its value when the record holds it; a key built by `artefactKey` is answered with the boolean the record holds for that artefact; every other key, and any name or artefact the record does not hold, is not found.
 * @param record - What is known.
 * @returns A `Facts` port reading the record.
 */
export const factsFrom = (record: FactRecord): Facts => {
  const values = new Map(Object.entries(record.values));
  const artefacts = new Map(Object.entries(record.artefacts));

  return (key) => {
    if (typeof key === "string") {
      const value = values.get(key);

      return value === undefined ? { found: false } : { found: true, value };
    }
    const id = artefactOf(key);
    const provided = id === undefined ? undefined : artefacts.get(id);

    return provided === undefined
      ? { found: false }
      : { found: true, value: { kind: "boolean", value: provided } };
  };
};

/**
 * The named facts a condition reads: the string key of every `reference` node in it, each once, in the order first met walking the tree depth first. Reserved keys and other non-string keys are not names, so they are left out, and a reference's own key is never searched for further references.
 * @param condition - A trilean predicate or expression, such as a transition's `condition`.
 * @returns The names, each once.
 */
export const factNamesIn = (
  condition: PredicateNode | ExpressionNode,
): readonly string[] => {
  const names = new Set<string>();
  const pending: unknown[] = [condition];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (Array.isArray(node)) {
      const items: readonly unknown[] = node;
      pending.push(...[...items].reverse());
    } else if (typeof node === "object" && node !== null) {
      if ("kind" in node && node.kind === "reference" && "key" in node) {
        if (typeof node.key === "string") {
          names.add(node.key);
        }
      } else {
        const fields: readonly unknown[] = Object.values(node);
        pending.push(...[...fields].reverse());
      }
    }
  }

  return [...names];
};

/**
 * Layers facts ports: each key is answered by the first port that finds it, so an earlier port overrides a later one only where it knows the answer.
 * @param ports - The ports, most authoritative first.
 * @returns A `Facts` port that is not found only when no port finds the key.
 */
export const layeredFacts =
  (...ports: readonly Facts[]): Facts =>
  (key) => {
    for (const port of ports) {
      const answer = port(key);
      if (answer.found) {
        return answer;
      }
    }

    return { found: false };
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
