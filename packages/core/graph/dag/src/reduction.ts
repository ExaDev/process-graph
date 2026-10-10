import { assertAcyclic } from "./cycles.ts";
import { type Dag, type NodeId, assembleDag, lookup } from "./dag.ts";
import { topologicalLayers } from "./layers.ts";

/**
 * The transitive reduction: the same nodes with every redundant edge removed, so a node keeps a direct need only when no other need of it already depends on that node, transitively.
 *
 * Defined for acyclic graphs, where it is unique and has exactly the same ancestors and descendants as the input. Each node's remaining needs keep the order they had. Unknown references are carried over unchanged; they are not edges and take no part in reduction.
 *
 * Builds each node's full set of ancestors, so memory grows with the size of the transitive closure.
 * @throws CycleError when the graph contains a cycle: with one the reduction is not unique, so nothing is guessed.
 */
export function transitiveReduction<Id extends NodeId>(dag: Dag<Id>): Dag<Id> {
  assertAcyclic(dag);
  const ancestors = new Map<Id, ReadonlySet<Id>>();
  for (const layer of topologicalLayers(dag).layers) {
    for (const id of layer) {
      const closure = new Set<Id>();
      for (const need of lookup(dag.needs, id)) {
        closure.add(need);
        for (const further of lookup(ancestors, need)) {
          closure.add(further);
        }
      }
      ancestors.set(id, closure);
    }
  }

  // In an acyclic graph no node is its own ancestor, so a need never makes itself redundant.
  const reduced = new Map<Id, readonly Id[]>();
  for (const id of dag.nodes) {
    const direct = lookup(dag.needs, id);
    reduced.set(
      id,
      direct.filter(
        (candidate) =>
          !direct.some((other) => lookup(ancestors, other).has(candidate)),
      ),
    );
  }

  return assembleDag(dag.nodes, reduced, dag.unknownReferences);
}
