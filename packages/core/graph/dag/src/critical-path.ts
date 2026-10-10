import { assertAcyclic } from "./cycles.ts";
import { type Dag, type NodeId, lookup } from "./dag.ts";
import { topologicalLayers } from "./layers.ts";

/**
 * The most expensive chain through a graph.
 */
export interface CriticalPath<Id extends NodeId> {
  /** The chain in dependency order: each node needs the one before it. Empty only for a graph with no nodes. */
  readonly path: readonly Id[];
  /** The sum of the weights of the nodes on `path`. */
  readonly weight: number;
}

/**
 * The longest weighted chain along `needs`, where a chain's weight is the sum of its nodes' weights.
 *
 * `weight` is called exactly once per node, in node order, and must return a finite number that is not negative. The returned path always runs back to a node with no needs and ends at the node whose chain is heaviest.
 *
 * Ties are broken deterministically, and the rule is part of the contract. Where several needs of a node give an equally heavy chain, the one that comes first in node order is followed. Where several nodes end an equally heavy chain, the one that comes first in node order ends it. A zero-weight node therefore never shortens the path back to the start, and a zero-weight dependent never extends the path past an earlier node of equal total.
 *
 * Defined for acyclic graphs. An empty graph returns `{ path: [], weight: 0 }`. Unknown references are not edges.
 * @throws CycleError when the graph contains a cycle: a chain through a cycle has no greatest weight.
 * @throws RangeError when `weight` returns a negative or non-finite number.
 */
export function criticalPath<Id extends NodeId>(
  dag: Dag<Id>,
  weight: (id: Id) => number,
): CriticalPath<Id> {
  assertAcyclic(dag);
  const weights = new Map<Id, number>();
  for (const id of dag.nodes) {
    const value = weight(id);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `The weight of "${String(id)}" must be a finite, non-negative number, got ${String(value)}`,
      );
    }
    weights.set(id, value);
  }

  const position = new Map(dag.nodes.map((id, order) => [id, order]));
  const total = new Map<Id, number>();
  const previous = new Map<Id, Id>();
  for (const layer of topologicalLayers(dag).layers) {
    for (const id of layer) {
      let best: Id | undefined;
      let bestTotal = 0;
      for (const need of lookup(dag.needs, id)) {
        const candidate = lookup(total, need);
        if (
          best === undefined ||
          candidate > bestTotal ||
          (candidate === bestTotal &&
            lookup(position, need) < lookup(position, best))
        ) {
          best = need;
          bestTotal = candidate;
        }
      }
      total.set(id, lookup(weights, id) + bestTotal);
      if (best !== undefined) {
        previous.set(id, best);
      }
    }
  }

  let end: Id | undefined;
  for (const id of dag.nodes) {
    if (end === undefined || lookup(total, id) > lookup(total, end)) {
      end = id;
    }
  }
  if (end === undefined) {
    return { path: [], weight: 0 };
  }

  const path: Id[] = [];
  for (
    let node: Id | undefined = end;
    node !== undefined;
    node = previous.get(node)
  ) {
    path.push(node);
  }

  return { path: path.reverse(), weight: lookup(total, end) };
}
