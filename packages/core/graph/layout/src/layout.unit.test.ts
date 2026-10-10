import {
  toFlowchart,
  toStateMachine,
  toSwimlane,
} from "@exadev/process-graph-projection";
import { defineModel } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import type {
  EngineBox,
  EngineGraph,
  EngineGroup,
  LayoutEngine,
} from "./engine.ts";
import { layout } from "./layout.ts";

const diamond = defineModel({
  participants: [],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "split", label: "Split" },
    { kind: "activity", id: "left", label: "Left" },
    { kind: "activity", id: "right", label: "Right" },
    { kind: "activity", id: "join", label: "Join" },
  ],
  transitions: [
    { id: "t1", source: "split", target: "left" },
    { id: "t2", source: "split", target: "right" },
    { id: "t3", source: "left", target: "join" },
    { id: "t4", source: "right", target: "join" },
  ],
  fragments: [],
  projections: [],
});

const handover = defineModel({
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "courier", label: "Courier", kind: "role" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    { kind: "activity", id: "order", label: "Order", actor: "customer" },
    { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
    { kind: "activity", id: "pay", label: "Pay", actor: "customer" },
    { kind: "activity", id: "ship", label: "Ship", actor: "shop" },
    { kind: "pseudo", id: "end", role: "final" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "order" },
    { id: "t2", source: "order", target: "pack" },
    { id: "t3", source: "order", target: "pay" },
    { id: "t4", source: "pack", target: "ship" },
    { id: "t5", source: "pay", target: "ship" },
    { id: "t6", source: "ship", target: "end" },
  ],
  fragments: [],
  projections: [],
});

const lifecycle = defineModel({
  participants: [{ id: "invoice", label: "Invoice", kind: "entity" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    { kind: "state", id: "draft", label: "Draft" },
    { kind: "state", id: "paid", label: "Paid" },
    { kind: "pseudo", id: "end", role: "final" },
  ],
  transitions: [
    { id: "t1", source: "start", target: "draft" },
    { id: "t2", source: "draft", target: "paid" },
    { id: "t3", source: "paid", target: "end" },
  ],
  fragments: [],
  projections: [],
});

const positionOf = (
  positions:
    Readonly<Partial<Record<string, { x: number; y: number }>>> | undefined,
  id: string,
): { x: number; y: number } => {
  const position = positions?.[id];
  if (position === undefined) {
    throw new Error(`no position for ${id}`);
  }

  return position;
};

describe("layout of a flowchart", () => {
  it("places the join to the right of both branches when edges run right", async () => {
    const result = await layout(toFlowchart(diamond), { direction: "right" });
    const flowchart = result.views.flowchart;
    const split = positionOf(flowchart, "split");
    const left = positionOf(flowchart, "left");
    const right = positionOf(flowchart, "right");
    const join = positionOf(flowchart, "join");

    expect(left.x).toBeGreaterThan(split.x);
    expect(right.x).toBe(left.x);
    expect(left.y).not.toBe(right.y);
    expect(join.x).toBeGreaterThan(left.x);
    expect(join.x).toBeGreaterThan(right.x);
  });

  it("places the join below both branches when edges run down", async () => {
    const result = await layout(toFlowchart(diamond), { direction: "down" });
    const flowchart = result.views.flowchart;
    const left = positionOf(flowchart, "left");
    const right = positionOf(flowchart, "right");
    const join = positionOf(flowchart, "join");

    expect(join.y).toBeGreaterThan(left.y);
    expect(join.y).toBeGreaterThan(right.y);
    expect(left.y).toBe(right.y);
    expect(left.x).not.toBe(right.x);
  });

  it("keys positions by notation and reports no lanes", async () => {
    const result = await layout(toFlowchart(diamond));

    expect(Object.keys(result.views)).toEqual(["flowchart"]);
    expect(Object.keys(result.views.flowchart ?? {}).sort()).toEqual([
      "join",
      "left",
      "right",
      "split",
    ]);
    expect(result.lanes).toEqual([]);
  });

  it("gives the same positions for the same input", async () => {
    const first = await layout(toFlowchart(handover));
    const second = await layout(toFlowchart(handover));

    expect(second).toEqual(first);
  });

  it("widens the gap between layers when asked", async () => {
    const compact = await layout(toFlowchart(diamond), {
      spacing: { layer: 16 },
    });
    const loose = await layout(toFlowchart(diamond), {
      spacing: { layer: 160 },
    });
    const gap = (flowchart: typeof compact.views.flowchart): number =>
      positionOf(flowchart, "left").x - positionOf(flowchart, "split").x;

    expect(gap(loose.views.flowchart)).toBeGreaterThan(
      gap(compact.views.flowchart),
    );
  });
});

describe("layout of a swimlane", () => {
  it("keeps every node inside the bounds of its lane", async () => {
    const swimlane = toSwimlane(handover);
    const result = await layout(swimlane);

    expect(result.lanes.map((lane) => lane.participant)).toEqual([
      "customer",
      "shop",
      "courier",
    ]);
    for (const lane of swimlane.lanes) {
      const bounds = result.lanes.find(
        (candidate) => candidate.participant === lane.participant,
      );
      expect(bounds).toBeDefined();
      for (const id of lane.nodes) {
        const position = positionOf(result.views.swimlane, id);
        const size = result.sizes[id];
        expect(size).toBeDefined();
        expect(position.x).toBeGreaterThanOrEqual(bounds?.x ?? Infinity);
        expect(position.y).toBeGreaterThanOrEqual(bounds?.y ?? Infinity);
        expect(position.x + (size?.width ?? Infinity)).toBeLessThanOrEqual(
          (bounds?.x ?? 0) + (bounds?.width ?? 0),
        );
        expect(position.y + (size?.height ?? Infinity)).toBeLessThanOrEqual(
          (bounds?.y ?? 0) + (bounds?.height ?? 0),
        );
      }
    }
  });

  it("gives an empty lane a usable extent and places nodes with no lane", async () => {
    const result = await layout(toSwimlane(handover));
    const courier = result.lanes.find((lane) => lane.participant === "courier");

    expect(courier?.width).toBeGreaterThan(0);
    expect(courier?.height).toBeGreaterThan(0);
    expect(positionOf(result.views.swimlane, "start")).toBeDefined();
    expect(positionOf(result.views.swimlane, "end")).toBeDefined();
  });

  it("does not overlap lanes", async () => {
    const { lanes } = await layout(toSwimlane(handover));

    for (const [index, first] of lanes.entries()) {
      for (const second of lanes.slice(index + 1)) {
        const apart =
          first.x + first.width <= second.x ||
          second.x + second.width <= first.x ||
          first.y + first.height <= second.y ||
          second.y + second.height <= first.y;
        expect(apart).toBe(true);
      }
    }
  });
});

describe("layout of a state machine", () => {
  it("orders states along the flow under the stateMachine notation", async () => {
    const result = await layout(toStateMachine(lifecycle, "invoice"));
    const states = result.views.stateMachine;
    const xs = ["start", "draft", "paid", "end"].map(
      (id) => positionOf(states, id).x,
    );

    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
    expect(result.views.flowchart).toBeUndefined();
  });

  it("sizes the initial pseudo-state smaller than a state", async () => {
    const result = await layout(toStateMachine(lifecycle, "invoice"));

    expect(result.sizes.start?.width).toBeLessThan(
      result.sizes.draft?.width ?? 0,
    );
  });
});

describe("layout with an injected engine", () => {
  const recorder = (): {
    engine: LayoutEngine;
    graphs: EngineGraph[];
  } => {
    const graphs: EngineGraph[] = [];
    const engine: LayoutEngine = {
      arrange: async (graph) => {
        await Promise.resolve();
        graphs.push(graph);
        const boxes: EngineBox[] = [];
        const visit = (nodes: EngineGraph["nodes"]): void => {
          for (const node of nodes) {
            boxes.push({
              id: node.id,
              x: boxes.length,
              y: 0,
              width: node.width,
              height: node.height,
            });
            if (node.children !== undefined) {
              visit(node.children);
            }
          }
        };
        visit(graph.nodes);

        return boxes;
      },
    };

    return { engine, graphs };
  };

  it("hands lanes to the engine as groups holding their nodes", async () => {
    const { engine, graphs } = recorder();
    await layout(toSwimlane(handover), { engine });

    const [graph] = graphs;
    const groups = graph?.nodes.filter(
      (node): node is EngineGroup => node.children !== undefined,
    );
    expect(groups?.map((group) => group.children.length)).toEqual(
      handover.participants.map(
        (participant) =>
          handover.elements.filter(
            (element) =>
              element.kind === "activity" && element.actor === participant.id,
          ).length,
      ),
    );
    expect(graph?.edges).toHaveLength(handover.transitions.length);
  });

  it("reads positions from the engine's boxes", async () => {
    const { engine } = recorder();
    const result = await layout(toFlowchart(diamond), { engine });

    const ids = ["split", "left", "right", "join"];

    // The recorder assigns x by visit order, which is the order of the view's nodes.
    expect(ids.map((id) => positionOf(result.views.flowchart, id).x)).toEqual(
      ids.map((_, index) => index),
    );
  });

  it("fails loudly when the engine omits a node", async () => {
    const engine: LayoutEngine = {
      arrange: async () => {
        await Promise.resolve();

        return [];
      },
    };

    await expect(layout(toFlowchart(diamond), { engine })).rejects.toThrow(
      'no box for element "split"',
    );
  });
});

describe("abort", () => {
  it("rejects with the reason when already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);

    await expect(
      layout(toFlowchart(diamond), { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("rejects when aborted while the engine is working", async () => {
    const engine: LayoutEngine = {
      arrange: async () => new Promise<readonly EngineBox[]>(() => undefined),
    };
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const pending = layout(toFlowchart(diamond), {
      engine,
      signal: controller.signal,
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("passes the signal to the engine", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const engine: LayoutEngine = {
      arrange: async (_graph, signal) => {
        await Promise.resolve();
        seen.push(signal);

        return [];
      },
    };
    const controller = new AbortController();
    await layout(toFlowchart(diamond), {
      engine,
      signal: controller.signal,
    }).catch(() => undefined);

    expect(seen).toEqual([controller.signal]);
  });
});
