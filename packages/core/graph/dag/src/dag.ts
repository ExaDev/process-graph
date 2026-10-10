import { UnknownNodeError } from "./errors.ts";

/**
 * The identifier of a node. Restricted to primitives so that two ids denote the same node exactly when they are strictly equal.
 */
export type NodeId = string | number;

/**
 * A `needs` target that is not a node of the graph, reported as data instead of being absorbed.
 */
export interface UnknownReference<Id extends NodeId> {
  /** The node whose `needs` named the missing target. */
  readonly from: Id;
  /** The target that is not a node. */
  readonly missing: Id;
}

/**
 * An immutable snapshot of a dependency graph: every node, the direct `needs` of each, the inverse relation, and the references that pointed outside the node set.
 *
 * The type does not promise acyclicity: a graph built from arbitrary input may contain cycles, which `findCycles` reports and the operations that need acyclicity document how they treat. Nothing here may be mutated by a caller.
 */
export interface Dag<Id extends NodeId> {
  /** Every node once, in the order the input first produced it. All other orderings in this package derive from this one. */
  readonly nodes: readonly Id[];
  /** For every node, the nodes it directly needs, without duplicates, in the order `needs` produced them, restricted to nodes of the graph. */
  readonly needs: ReadonlyMap<Id, readonly Id[]>;
  /** For every node, the nodes that directly need it, in node order. The inverse of `needs`. */
  readonly dependents: ReadonlyMap<Id, readonly Id[]>;
  /** Every `needs` target that is not a node, once per `{ from, missing }` pair, in node order and then `needs` order. These are not edges of the graph. */
  readonly unknownReferences: readonly UnknownReference<Id>[];
}

/**
 * Reads a value keyed by a node id out of a map built over a graph's nodes.
 * @throws UnknownNodeError when the id is not a node of that graph.
 */
export function lookup<Id extends NodeId, Value>(
  map: ReadonlyMap<Id, Value>,
  id: Id,
): Value {
  const value = map.get(id);
  if (value === undefined) {
    throw new UnknownNodeError(id);
  }

  return value;
}

/**
 * Assembles a graph from nodes and already-resolved direct needs, deriving the inverse relation. Internal: every needs target must be a node.
 */
export function assembleDag<Id extends NodeId>(
  nodes: readonly Id[],
  needs: ReadonlyMap<Id, readonly Id[]>,
  unknownReferences: readonly UnknownReference<Id>[],
): Dag<Id> {
  const dependents = new Map<Id, Id[]>(nodes.map((id) => [id, []]));
  for (const id of nodes) {
    for (const target of lookup(needs, id)) {
      lookup(dependents, target).push(id);
    }
  }

  return { nodes, needs, dependents, unknownReferences };
}

/**
 * Builds a graph once from a node set and a `needs` accessor.
 *
 * `nodes` is iterated once and duplicates are dropped, keeping the first occurrence. `needs` is called exactly once per distinct node, in node order, and its result is iterated once. A target that is not a node is recorded in `unknownReferences` and is not an edge. A node may need itself; that is a cycle of one, reported by `findCycles`.
 *
 * Never throws for malformed structure: cycles and unknown references are data on the result and in the analyses.
 * @param nodes - Every node of the graph.
 * @param needs - The direct needs of a node: the nodes that must come before it.
 */
export function buildDag<Id extends NodeId>(
  nodes: Readonly<Iterable<Id>>,
  needs: (id: Id) => Iterable<Id>,
): Dag<Id> {
  const ordered = [...new Set(nodes)];
  const known = new Set(ordered);
  const resolved = new Map<Id, readonly Id[]>();
  const unknownReferences: UnknownReference<Id>[] = [];
  for (const id of ordered) {
    const direct = new Set<Id>();
    const missing = new Set<Id>();
    for (const target of needs(id)) {
      if (known.has(target)) {
        direct.add(target);
      } else {
        missing.add(target);
      }
    }
    resolved.set(id, [...direct]);
    for (const target of missing) {
      unknownReferences.push({ from: id, missing: target });
    }
  }

  return assembleDag(ordered, resolved, unknownReferences);
}
