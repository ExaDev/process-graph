import { type Dag, type NodeId, lookup } from "./dag.ts";
import { CycleError } from "./errors.ts";

interface TarjanFrame<Id extends NodeId> {
  readonly node: Id;
  next: number;
}

/**
 * Every strongly connected component of the graph: the maximal sets of nodes in which each node reaches every other along `needs` edges. Every node is in exactly one component, and a node on no cycle is a component of its own. Found by Tarjan's algorithm with an explicit stack, so depth is bounded by memory, not by the call stack, and each node and edge is visited once.
 *
 * A component lists its nodes in the order Tarjan's algorithm completes them, its root last. Components come out in reverse topological order of the condensed graph along `needs`: a component appears before every component that needs it. Since mutual reachability is symmetric, the components are the same whichever direction the edges are read in.
 * @param dag - The graph to partition.
 * @returns Every component, each a non-empty list of nodes.
 */
export function stronglyConnectedComponents<Id extends NodeId>(
  dag: Dag<Id>,
): readonly (readonly Id[])[] {
  const index = new Map<Id, number>();
  const lowLink = new Map<Id, number>();
  const onStack = new Set<Id>();
  const stack: Id[] = [];
  const components: Id[][] = [];

  // Pops the component rooted at `root` off the stack: every node pushed since `root`, and `root` itself.
  const popComponent = (root: Id): Id[] => {
    const component: Id[] = [];
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      component.push(member);
      if (member === root) {
        break;
      }
    }

    return component;
  };

  const visit = (node: Id): void => {
    index.set(node, index.size);
    lowLink.set(node, lookup(index, node));
    stack.push(node);
    onStack.add(node);
  };

  for (const root of dag.nodes) {
    if (index.has(root)) {
      continue;
    }
    visit(root);
    const frames: TarjanFrame<Id>[] = [{ node: root, next: 0 }];
    for (
      let frame = frames.at(-1);
      frame !== undefined;
      frame = frames.at(-1)
    ) {
      const targets = lookup(dag.needs, frame.node);
      const target = targets[frame.next];
      if (target !== undefined) {
        frame.next += 1;
        if (!index.has(target)) {
          visit(target);
          frames.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          lowLink.set(
            frame.node,
            Math.min(lookup(lowLink, frame.node), lookup(index, target)),
          );
        }
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent !== undefined) {
        lowLink.set(
          parent.node,
          Math.min(lookup(lowLink, parent.node), lookup(lowLink, frame.node)),
        );
      }
      if (lookup(lowLink, frame.node) === lookup(index, frame.node)) {
        components.push(popComponent(frame.node));
      }
    }
  }

  return components;
}

/**
 * The shortest closed path along `needs` edges from `start` back to itself, staying inside `members`. Ties between equally short paths go to the one found first when each node's needs are read in order.
 */
function shortestCycleThrough<Id extends NodeId>(
  dag: Dag<Id>,
  start: Id,
  members: ReadonlySet<Id>,
): readonly Id[] {
  const parent = new Map<Id, Id>();
  const queue: Id[] = [start];
  for (const current of queue) {
    for (const target of lookup(dag.needs, current)) {
      if (target === start) {
        const between: Id[] = [];
        for (let node = current; node !== start; node = lookup(parent, node)) {
          between.push(node);
        }

        return [start, ...between.reverse(), start];
      }
      if (members.has(target) && !parent.has(target)) {
        parent.set(target, current);
        queue.push(target);
      }
    }
  }
  throw new Error(
    `Invariant violated: "${String(start)}" is in a strongly connected component but no cycle passes through it`,
  );
}

/**
 * Reports every cycle in the graph: exactly one closed path per strongly connected component that contains a cycle (more than one node, or a node that needs itself).
 *
 * A path lists nodes such that each needs the next and the last needs the first, which is repeated at the end: `[a, b, c, a]` means a needs b, b needs c and c needs a. A self-loop is `[a, a]`. The path is a shortest cycle through the component's first node in node order, ties going to the earliest needs. Paths are ordered by the position of their first node. A component can contain more cycles than the one reported; removing the reported cycle's edges and calling again finds the rest.
 *
 * Returns an empty array exactly when the graph is acyclic. Iterative, so a deep graph cannot overflow the call stack.
 */
export function findCycles<Id extends NodeId>(
  dag: Dag<Id>,
): readonly (readonly Id[])[] {
  const position = new Map(dag.nodes.map((id, order) => [id, order]));
  const found: { readonly first: number; readonly path: readonly Id[] }[] = [];
  for (const component of stronglyConnectedComponents(dag)) {
    const [only] = component;
    if (
      component.length === 1 &&
      only !== undefined &&
      !lookup(dag.needs, only).includes(only)
    ) {
      continue;
    }
    const members = new Set(component);
    const ranked = component
      .map((id) => ({ id, order: lookup(position, id) }))
      .sort((a, b) => a.order - b.order);
    const [earliest] = ranked;
    if (earliest === undefined) {
      continue;
    }
    found.push({
      first: earliest.order,
      path: shortestCycleThrough(dag, earliest.id, members),
    });
  }

  return found.sort((a, b) => a.first - b.first).map(({ path }) => path);
}

/**
 * Throws a `CycleError` unless the graph is acyclic.
 * @throws CycleError carrying `findCycles(dag)` when the graph contains a cycle.
 */
export function assertAcyclic<Id extends NodeId>(dag: Dag<Id>): void {
  const cycles = findCycles(dag);
  if (cycles.length > 0) {
    throw new CycleError(cycles);
  }
}
