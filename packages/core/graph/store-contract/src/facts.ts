import { emptyFactRecord, type FactRecord } from "@exadev/process-graph-domain";
import type { Issue, Model, OpenIds } from "@exadev/process-graph-schema";
import type { FactChange, FactClearing } from "./schema.ts";

/**
 * The write rules for a model's fact record, shared by every store so each keeps facts the same way. Each function returns a new record and never changes the one it is given.
 */

/** The entries of a record whose key passes a test. */
const entriesWhere = <V>(
  record: Readonly<Record<string, V>>,
  keep: (key: string) => boolean,
): Readonly<Record<string, V>> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)));

/**
 * Keeps only the artefact entries of a record that name an artefact the model declares, so replacing a model drops what was known about artefacts it no longer has. Named facts belong to the run rather than to any record of the model, so they are all kept.
 * @param model - The model the record is for.
 * @param facts - The record to narrow.
 * @returns The record with its artefacts narrowed to the model's.
 */
export const factsWithin = (
  model: Model<OpenIds>,
  facts: FactRecord,
): FactRecord => {
  const declared = new Set(model.artefacts.map(({ id }) => id));

  return {
    artefacts: entriesWhere(facts.artefacts, (id) => declared.has(id)),
    values: facts.values,
  };
};

/**
 * Applies a change to a record: each artefact and named fact the change gives replaces what the record held for it, and the rest is kept. The result is not checked; see `factIssues`.
 * @param facts - The stored record.
 * @param change - The facts to record.
 * @returns The merged record.
 */
export const mergeFacts = (
  facts: FactRecord,
  change: FactChange,
): FactRecord => ({
  artefacts: { ...facts.artefacts, ...change.artefacts },
  values: { ...facts.values, ...change.values },
});

/**
 * Forgets facts, so what they named is unknown again: the whole record with `all`, otherwise the named artefacts and named facts. A name the record does not hold is ignored.
 * @param facts - The stored record.
 * @param clearing - What to forget.
 * @returns The record without what was forgotten.
 */
export const withoutFacts = (
  facts: FactRecord,
  clearing: FactClearing,
): FactRecord => {
  if ("all" in clearing) {
    return emptyFactRecord;
  }
  const artefacts = new Set(clearing.artefacts);
  const values = new Set(clearing.values);

  return {
    artefacts: entriesWhere(facts.artefacts, (id) => !artefacts.has(id)),
    values: entriesWhere(facts.values, (name) => !values.has(name)),
  };
};

/**
 * The issues with a change to a model's facts: an artefact the model does not declare is an `unknown-reference`, as an unknown reference anywhere else in a model is. Named facts are free names, since any `reference` key in a condition may read one.
 * @param model - The model the facts are for.
 * @param change - The facts to record.
 * @returns One issue per undeclared artefact, empty when every artefact resolves.
 */
export const factIssues = (
  model: Model<OpenIds>,
  change: FactChange,
): readonly Issue[] => {
  const declared = new Set(model.artefacts.map(({ id }) => id));

  return Object.keys(change.artefacts ?? {}).flatMap((id) =>
    declared.has(id)
      ? []
      : [
          {
            code: "unknown-reference" as const,
            message: `facts refer to unknown artefact id "${id}"`,
          },
        ],
  );
};
