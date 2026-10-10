import { type Dag, type NodeId, lookup } from "./dag.ts";

/**
 * Every node reachable from `from` by following `edges` one or more times, in node order.
 */
function reachable<Id extends NodeId>(
  dag: Dag<Id>,
  edges: ReadonlyMap<Id, readonly Id[]>,
  from: Id,
): readonly Id[] {
  const found = new Set<Id>();
  const pending = [...lookup(edges, from)];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (found.has(node)) {
      continue;
    }
    found.add(node);
    pending.push(...lookup(edges, node));
  }

  return dag.nodes.filter((id) => found.has(id));
}

/**
 * Every node `id` depends on, directly or through other nodes: the transitive closure of `needs` from `id`, in node order.
 *
 * `id` itself is included exactly when it lies on a cycle, since it then depends on itself. Unknown references are not edges. Iterative, so depth cannot overflow the call stack.
 * @throws UnknownNodeError when `id` is not a node of the graph.
 */
export function ancestorsOf<Id extends NodeId>(
  dag: Dag<Id>,
  id: Id,
): readonly Id[] {
  return reachable(dag, dag.needs, id);
}

/**
 * Every node that depends on `id`, directly or through other nodes: the transitive closure of the inverse of `needs` from `id`, in node order.
 *
 * `id` itself is included exactly when it lies on a cycle. Iterative, so depth cannot overflow the call stack.
 * @throws UnknownNodeError when `id` is not a node of the graph.
 */
export function descendantsOf<Id extends NodeId>(
  dag: Dag<Id>,
  id: Id,
): readonly Id[] {
  return reachable(dag, dag.dependents, id);
}
