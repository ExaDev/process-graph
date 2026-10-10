import { type Dag, buildDag, lookup } from "../dag.ts";

/**
 * Builds a graph from a table of node to needs, taking node order from the table's key order. A need that is not a key becomes an unknown reference.
 */
export function dagOf(
  table: Readonly<Record<string, readonly string[]>>,
): Dag<string> {
  const needs = new Map(Object.entries(table));

  return buildDag(needs.keys(), (id) => lookup(needs, id));
}
