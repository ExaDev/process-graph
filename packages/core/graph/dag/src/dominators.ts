import { type Dag, type NodeId, lookup } from "./dag.ts";

/**
 * The immediate dominator of every node reachable from `root` along `needs` edges. A node `d` dominates `n` when every path from `root` to `n` passes through `d`; the immediate dominator is the dominator closest to `n` other than `n` itself. Read with `needs` edges pointing from a step to the steps before it and `root` a virtual end every last step needs, this gives post-dominators: where every way forward from a step meets again.
 *
 * Found by the Lengauer-Tarjan algorithm with path compression, so the work is the number of reachable nodes and edges times a slowly growing factor, and every walk uses an explicit stack, so depth is bounded by memory, not the call stack. Cycles are allowed.
 * @param dag - The graph to read.
 * @param root - Where every path starts.
 * @returns Each node reachable from `root` other than `root`, mapped to its immediate dominator, in the order a depth-first walk from `root` first reaches the nodes. A node `root` does not reach has no entry.
 * @throws UnknownNodeError when `root` is not a node of `dag`.
 */
export function immediateDominators<Id extends NodeId>(
  dag: Dag<Id>,
  root: Id,
): ReadonlyMap<Id, Id> {
  lookup(dag.needs, root);

  // Depth-first numbering from the root: `order[i]` is the node numbered i, and `parent[i]` the number of the node it was reached from.
  const number = new Map<Id, number>();
  const order: Id[] = [];
  const parent: number[] = [];
  const frames: { readonly node: Id; next: number }[] = [];
  const enter = (node: Id, from: number): void => {
    number.set(node, order.length);
    order.push(node);
    parent.push(from);
    frames.push({ node, next: 0 });
  };
  enter(root, -1);
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const target = lookup(dag.needs, frame.node)[frame.next];
    if (target === undefined) {
      frames.pop();
      continue;
    }
    frame.next += 1;
    if (!number.has(target)) {
      enter(target, lookup(number, frame.node));
    }
  }

  // Predecessors of each numbered node among the numbered nodes, by number.
  const predecessors: number[][] = order.map(() => []);
  for (const [index, node] of order.entries()) {
    for (const target of lookup(dag.needs, node)) {
      predecessors[lookup(number, target)]?.push(index);
    }
  }

  const semi = order.map((_, index) => index);
  const idom = order.map(() => 0);
  const ancestor = order.map(() => -1);
  const label = order.map((_, index) => index);
  const bucket: number[][] = order.map(() => []);

  /** Path compression up the forest built by `link`, done with an explicit stack. */
  const compress = (start: number): void => {
    const path: number[] = [];
    for (
      let node = start;
      (ancestor[ancestor[node] ?? -1] ?? -1) !== -1;
      node = ancestor[node] ?? -1
    ) {
      path.push(node);
    }
    for (const node of path.toReversed()) {
      const up = ancestor[node] ?? -1;
      const upLabel = label[up] ?? up;
      if ((semi[upLabel] ?? 0) < (semi[label[node] ?? node] ?? 0)) {
        label[node] = upLabel;
      }
      ancestor[node] = ancestor[up] ?? -1;
    }
  };
  /** The node with the least semidominator on the forest path to `node`. */
  const evaluate = (node: number): number => {
    if (ancestor[node] === -1) {
      return node;
    }
    compress(node);

    return label[node] ?? node;
  };

  for (let index = order.length - 1; index > 0; index -= 1) {
    for (const from of predecessors[index] ?? []) {
      const least = semi[evaluate(from)] ?? index;
      if (least < (semi[index] ?? index)) {
        semi[index] = least;
      }
    }
    bucket[semi[index] ?? index]?.push(index);
    const up = parent[index] ?? 0;
    ancestor[index] = up;
    for (const waiting of bucket[up] ?? []) {
      const least = evaluate(waiting);
      idom[waiting] = (semi[least] ?? 0) < (semi[waiting] ?? 0) ? least : up;
    }
    bucket[up] = [];
  }
  const dominators = new Map<Id, Id>();
  for (let index = 1; index < order.length; index += 1) {
    if (idom[index] !== semi[index]) {
      idom[index] = idom[idom[index] ?? 0] ?? 0;
    }
    const node = order[index];
    const dominator = order[idom[index] ?? 0];
    if (node !== undefined && dominator !== undefined) {
      dominators.set(node, dominator);
    }
  }

  return dominators;
}
