import { describe, expect, it } from "vitest";
import { type Dag, lookup } from "./dag.ts";
import { immediateDominators } from "./dominators.ts";
import { dagOf } from "./test-support/dag-of.ts";

/** Far deeper than any call stack tolerates in a recursive walk, so an accidental recursion fails here. */
const deepChainLength = 100_000;
/** Enough small random graphs to meet diamonds, loops, irreducible cycles and unreachable nodes. */
const randomGraphs = 300;
/** Nodes per random graph: small enough that the reference's set intersections stay cheap. */
const randomNodes = 9;
/** Edges per node, on average, in a random graph: dense enough for several paths between most nodes. */
const randomDensity = 2;

/**
 * The reference: every node's dominators as a set, by the textbook fixed point (a node's dominators are itself plus the intersection of its predecessors'), then the immediate dominator as the strict dominator that every other strict dominator dominates.
 */
const referenceDominators = (
  dag: Dag<string>,
  root: string,
): ReadonlyMap<string, string> => {
  const reachable = new Set<string>([root]);
  const stack = [root];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const target of lookup(dag.needs, next)) {
      if (!reachable.has(target)) {
        reachable.add(target);
        stack.push(target);
      }
    }
  }
  const nodes = dag.nodes.filter((node) => reachable.has(node));
  const predecessors = new Map<string, string[]>(
    nodes.map((node) => [node, []]),
  );
  for (const node of nodes) {
    for (const target of lookup(dag.needs, node)) {
      lookup(predecessors, target).push(node);
    }
  }
  const dominators = new Map<string, Set<string>>(
    nodes.map((node) => [
      node,
      node === root ? new Set([root]) : new Set(nodes),
    ]),
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes) {
      if (node === root) {
        continue;
      }
      const sets = lookup(predecessors, node).map((from) =>
        lookup(dominators, from),
      );
      const next = new Set<string>([
        node,
        ...[...(sets[0] ?? [])].filter((candidate) =>
          sets.every((set) => set.has(candidate)),
        ),
      ]);
      if (next.size !== lookup(dominators, node).size) {
        dominators.set(node, next);
        changed = true;
      }
    }
  }
  const immediate = new Map<string, string>();
  for (const node of nodes) {
    const strict = [...lookup(dominators, node)].filter(
      (other) => other !== node,
    );
    const closest = strict.find((candidate) =>
      strict.every((other) => lookup(dominators, candidate).has(other)),
    );
    if (closest !== undefined) {
      immediate.set(node, closest);
    }
  }

  return immediate;
};

/** The multiplier, increment and modulus of the ANSI C linear congruential generator, a well-known full-period choice. */
const lcgMultiplier = 1_103_515_245;
const lcgIncrement = 12_345;
const lcgModulus = 2_147_483_648;

/** A deterministic sequence of pseudo-random integers below `bound`, so a failing graph can be rebuilt. */
const sequence = (seed: number): ((bound: number) => number) => {
  let state = seed;

  return (bound) => {
    state = (state * lcgMultiplier + lcgIncrement) % lcgModulus;

    return state % bound;
  };
};

const randomGraph = (seed: number): Dag<string> => {
  const next = sequence(seed);
  const names = Array.from(
    { length: randomNodes },
    (_, index) => `n${String(index)}`,
  );
  const table: Record<string, string[]> = Object.fromEntries(
    names.map((name) => [name, []]),
  );
  for (let edge = 0; edge < randomNodes * randomDensity; edge += 1) {
    const from = names[next(randomNodes)];
    const to = names[next(randomNodes)];
    if (from !== undefined && to !== undefined) {
      table[from]?.push(to);
    }
  }

  return dagOf(table);
};

describe("immediateDominators", () => {
  it("finds where both sides of a diamond meet", () => {
    expect(
      immediateDominators(
        dagOf({
          start: ["left", "right"],
          left: ["join"],
          right: ["join"],
          join: [],
        }),
        "start",
      ),
    ).toEqual(
      new Map([
        ["left", "start"],
        ["join", "start"],
        ["right", "start"],
      ]),
    );
  });

  it("dominates a loop's body by its entry and leaves unreachable nodes out", () => {
    expect(
      immediateDominators(
        dagOf({ a: ["b"], b: ["c", "d"], c: ["b"], d: [], orphan: ["a"] }),
        "a",
      ),
    ).toEqual(
      new Map([
        ["b", "a"],
        ["c", "b"],
        ["d", "b"],
      ]),
    );
  });

  it("agrees with the textbook fixed point on many random graphs", () => {
    for (let seed = 1; seed <= randomGraphs; seed += 1) {
      const graph = randomGraph(seed);

      expect(immediateDominators(graph, "n0")).toEqual(
        referenceDominators(graph, "n0"),
      );
    }
  });

  it("walks a chain deeper than any call stack without recursing", () => {
    const table = Object.fromEntries(
      Array.from({ length: deepChainLength }, (_, index) => [
        `n${String(index)}`,
        index + 1 < deepChainLength ? [`n${String(index + 1)}`] : [],
      ]),
    );
    const dominators = immediateDominators(dagOf(table), "n0");

    expect(dominators.get(`n${String(deepChainLength - 1)}`)).toBe(
      `n${String(deepChainLength - 2)}`,
    );
  });
});
