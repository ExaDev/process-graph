import { type Dag, type NodeId, lookup } from "./dag.ts";

/**
 * The result of layering a graph by dependency depth.
 */
export interface TopologicalLayers<Id extends NodeId> {
  /** Each layered node's level: the length of the longest `needs` chain below it, so a node with no needs is 0 and every other node is one more than its highest-level need. */
  readonly levels: ReadonlyMap<Id, number>;
  /** Nodes grouped by level, index 0 first. Within a layer, nodes are in node order. Every node of a layer needs only nodes of earlier layers, and nothing in one layer needs anything in the same layer. */
  readonly layers: readonly (readonly Id[])[];
  /** The nodes that have no level because they lie on a cycle or transitively need a node that does, in node order. Empty exactly when the graph is acyclic. */
  readonly unlayered: readonly Id[];
}

/**
 * Layers the graph by the longest `needs` chain below each node, so everything in one layer can run once the earlier layers are done.
 *
 * Defined on the acyclic part of the graph: a node on a cycle, or one that needs such a node directly or transitively, has no finite chain length and is reported in `unlayered` rather than being given a level. Every other node is layered exactly as in an acyclic graph. Unknown references are not edges and contribute nothing to a level. Iterative (Kahn's algorithm), so depth cannot overflow the call stack.
 */
export function topologicalLayers<Id extends NodeId>(
  dag: Dag<Id>,
): TopologicalLayers<Id> {
  const depth = new Map<Id, number>(dag.nodes.map((id) => [id, 0]));
  const waitingOn = new Map<Id, number>(
    dag.nodes.map((id) => [id, lookup(dag.needs, id).length]),
  );
  const ready: Id[] = dag.nodes.filter((id) => lookup(waitingOn, id) === 0);
  for (const current of ready) {
    const above = lookup(depth, current) + 1;
    for (const dependent of lookup(dag.dependents, current)) {
      depth.set(dependent, Math.max(lookup(depth, dependent), above));
      const remaining = lookup(waitingOn, dependent) - 1;
      waitingOn.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  const levels = new Map<Id, number>();
  const layers: Id[][] = [];
  const unlayered: Id[] = [];
  for (const id of dag.nodes) {
    if (lookup(waitingOn, id) !== 0) {
      unlayered.push(id);
      continue;
    }
    const level = lookup(depth, id);
    levels.set(id, level);
    (layers[level] ??= []).push(id);
  }

  return { levels, layers, unlayered };
}
