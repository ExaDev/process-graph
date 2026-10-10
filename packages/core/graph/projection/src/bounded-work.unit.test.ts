import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import {
  applyModelDiff,
  diffFlowchart,
  type FlowEdge,
  type FlowNode,
  type ModelDiff,
} from "./index.ts";

/**
 * The work these tests measure is the number of item reads through a counting proxy. A fixed number of passes over the input reads exactly twice as many items when the input doubles; a scan of the whole input per item reads four times as many. Each test therefore compares a size with its double rather than holding a threshold.
 */
const size = 400;

/** A copy of `items` whose indexed reads are counted, and the count so far. */
const counted = <T>(
  items: readonly T[],
): { readonly items: readonly T[]; readonly reads: () => number } => {
  let reads = 0;
  const proxy = new Proxy([...items], {
    get: (target, key, receiver): unknown => {
      if (typeof key === "string" && /^\d+$/u.test(key)) {
        reads += 1;
      }

      return Reflect.get(target, key, receiver);
    },
  });

  return { items: proxy, reads: () => reads };
};

const ids = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index)}`);

const empty: Model<OpenIds> = {
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [],
  transitions: [],
  fragments: [],
  projections: [],
};

/** Edge reads `diffFlowchart` makes for an edit adding `count` bars joined in a ring. */
const barEdgeReads = (count: number): number => {
  const bars = ids(count, "bar-");
  const nodes: FlowNode<OpenIds>[] = bars.map((id) => ({
    id,
    label: "Fork",
    shape: "bar",
  }));
  // A ring, so the edges are exactly as many as the bars.
  const edges = counted<FlowEdge<OpenIds>>(
    bars.map((id, index) => ({
      from: id,
      to: bars[(index + 1) % count] ?? id,
      transitions: [`t-${id}`],
    })),
  );
  diffFlowchart(empty, { nodes, edges: edges.items });

  return edges.reads();
};

/** Change reads `applyModelDiff` makes renaming every one of `count` activities. */
const renameReads = (count: number): number => {
  const activities = ids(count, "a-");
  const model: Model<OpenIds> = {
    ...empty,
    elements: activities.map((id) => ({ kind: "activity", id, label: id })),
  };
  const changes = counted<ModelDiff<OpenIds>["elements"][number]>(
    activities.map((id) => ({
      kind: "renamed",
      element: id,
      from: id,
      to: `${id}!`,
      inferred: false,
    })),
  );
  applyModelDiff(model, {
    elements: changes.items,
    transitions: [],
    events: [],
  });

  return changes.reads();
};

describe("work grows in proportion to the input", () => {
  it("diffFlowchart reads the edited edges a fixed number of times however many bars are added", () => {
    expect(barEdgeReads(2 * size)).toBe(2 * barEdgeReads(size));
  });

  it("applyModelDiff reads each change a fixed number of times however many elements change", () => {
    expect(renameReads(2 * size)).toBe(2 * renameReads(size));
  });
});
