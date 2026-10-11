import {
  blockedBy,
  criticalPath,
  deriveStatuses,
} from "@exadev/process-graph-domain";
import { layout } from "@exadev/process-graph-layout";
import {
  toFlowchart,
  toStateMachine,
  toSwimlane,
} from "@exadev/process-graph-projection";
import { noFacts } from "@exadev/process-graph-react";
import { defineModel, type Overlay } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { toFlow, type FlowRun, type FlowView } from "./flow.ts";
import type { OrderIds } from "./test-support/ids.ts";
import { order } from "./test-support/order.ts";
import { stubEngine } from "./test-support/stub-engine.ts";

const submitted: Overlay<OrderIds> = { "a-submit": "done" };

const runOf = (overlay: Overlay<OrderIds>): FlowRun<OrderIds> => {
  const statuses = deriveStatuses(order, overlay, noFacts);

  return {
    model: order,
    statuses,
    criticalPath: criticalPath(order, overlay, noFacts, () => 1).path,
    blockers: new Map(
      [...statuses]
        .filter(([, status]) => status === "blocked")
        .map(([id]) => [id, blockedBy(order, overlay, noFacts, id)]),
    ),
    shown: new Set(order.elements.map((element) => element.id)),
    direction: "right",
  };
};

const defined = <V>(value: V | undefined, what: string): V => {
  if (value === undefined) {
    throw new Error(`no ${what}`);
  }

  return value;
};

const drawn = async (flow: FlowView<OrderIds>) => {
  const { engine } = stubEngine();
  const placement = await layout(flow.view, { engine });

  return { placement, ...toFlow(flow, placement, runOf(submitted)) };
};

describe("toFlow on a swimlane", () => {
  const swimlane = { notation: "swimlane", view: toSwimlane(order) } as const;

  test("draws each lane as a group node at its laid-out bounds, before the nodes it holds", async () => {
    const { nodes, placement } = await drawn(swimlane);

    const lanes = nodes.filter((node) => node.type === "lane");
    expect(lanes.map((lane) => lane.data.label)).toEqual([
      "Customer",
      "Shop",
      "Payment provider",
    ]);
    expect(
      lanes.map(({ position, width, height }) => ({
        ...position,
        width,
        height,
      })),
    ).toEqual(
      placement.lanes.map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height,
      })),
    );
    expect(nodes.findIndex((node) => node.type === "element")).toBe(
      lanes.length,
    );
  });

  test("places each element inside its lane, relative to it", async () => {
    const { nodes, placement } = await drawn(swimlane);

    const request = nodes.find((node) => node.id === "a-request");
    const shop = defined(placement.lanes[1], "shop lane");
    const absolute = defined(
      placement.views.swimlane?.["a-request"],
      "position",
    );
    expect(request?.parentId).toBe("lane:shop");
    expect(request?.position).toEqual({
      x: absolute.x - shop.x,
      y: absolute.y - shop.y,
    });
    expect(nodes.find((node) => node.id === "start")?.parentId).toBeUndefined();
  });

  test("gives each element node its status, critical path flag and blockers", async () => {
    const { nodes } = await drawn(swimlane);

    const data = new Map(
      nodes.flatMap((node) =>
        node.type === "element" ? [[node.id, node.data]] : [],
      ),
    );
    expect(data.get("a-submit")).toMatchObject({
      status: "done",
      critical: false,
    });
    expect(data.get("a-request")).toMatchObject({
      status: "ready",
      critical: true,
    });
    expect(data.get("a-pack")?.blockedBy).toEqual([
      { id: "a-request", label: "Request payment" },
    ]);
    expect(data.get("a-request")?.blockedBy).toBeUndefined();
  });

  test("marks the hand-offs and the steps of the critical path on the edges", async () => {
    const { edges } = await drawn(swimlane);

    expect(
      edges
        .filter((edge) => edge.data?.handoff === true)
        .map((edge) => edge.id),
    ).toEqual(["transition:t2", "transition:t3", "transition:t4"]);
    expect(
      edges
        .filter((edge) => edge.data?.critical === true)
        .map((edge) => edge.id),
    ).toEqual([
      "transition:t3",
      "transition:t4",
      "transition:t5",
      "transition:t7",
    ]);
    expect(edges.find((edge) => edge.id === "transition:t5")?.data?.label).toBe(
      "authorised",
    );
  });

  test("gives every element node its size and the handles edges route to", async () => {
    const { nodes, placement } = await drawn(swimlane);

    const request = nodes.find((node) => node.id === "a-request");
    const size = defined(placement.sizes["a-request"], "size");
    expect({ width: request?.width, height: request?.height }).toEqual(size);
    expect(request?.handles).toEqual([
      {
        type: "target",
        position: "left",
        x: 0,
        y: size.height / 2,
      },
      {
        type: "source",
        position: "right",
        x: size.width,
        y: size.height / 2,
      },
    ]);
  });
});

describe("toFlow on a flowchart", () => {
  test("draws no lanes and marks no hand-offs", async () => {
    const { nodes, edges } = await drawn({
      notation: "flowchart",
      view: toFlowchart(order),
    });

    expect(nodes.every((node) => node.type === "element")).toBe(true);
    expect(nodes.every((node) => node.parentId === undefined)).toBe(true);
    expect(edges.some((edge) => edge.data?.handoff === true)).toBe(false);
  });

  test("hides the elements a filter leaves out", async () => {
    const flow = { notation: "flowchart", view: toFlowchart(order) } as const;
    const { engine } = stubEngine();
    const placement = await layout(flow.view, { engine });
    const { nodes } = toFlow(flow, placement, {
      ...runOf(submitted),
      shown: new Set(["a-request"]),
    });

    expect(
      nodes.filter((node) => node.hidden !== true).map((node) => node.id),
    ).toEqual(["a-request"]);
  });
});

describe("critical steps", () => {
  /** Three steps in a chain, and a shortcut from the first to the last that is not a step of the chain. */
  const chain = defineModel({
    participants: [],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "a", label: "A" },
      { kind: "activity", id: "b", label: "B" },
      { kind: "activity", id: "c", label: "C" },
    ],
    transitions: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ac", source: "a", target: "c" },
    ],
    fragments: [],
    projections: [],
  });

  test("only an edge between consecutive elements of the critical path is a critical step", async () => {
    const flow = { notation: "flowchart", view: toFlowchart(chain) } as const;
    const { engine } = stubEngine();
    const placement = await layout(flow.view, { engine });
    const statuses = deriveStatuses(chain, {}, noFacts);
    const { edges } = toFlow(flow, placement, {
      model: chain,
      statuses,
      criticalPath: criticalPath(chain, {}, noFacts, () => 1).path,
      blockers: new Map(),
      shown: new Set(statuses.keys()),
      direction: "right",
    });

    expect(
      edges
        .filter((edge) => edge.data?.critical === true)
        .map((edge) => edge.id),
    ).toEqual(["transition:ab", "transition:bc"]);
  });
});

describe("toFlow on a state machine", () => {
  /** A ticket's lifecycle, with an event, a guard and an effect on one transition. */
  const ticket = defineModel({
    participants: [
      { id: "agent", label: "Agent", kind: "role" },
      { id: "ticket", label: "Ticket", kind: "entity" },
    ],
    events: [{ id: "ev-resolve", name: "resolve" }],
    actions: [{ id: "act-notify", name: "notify" }],
    artefacts: [],
    elements: [
      { kind: "pseudo", id: "start", role: "initial" },
      { kind: "state", id: "open", label: "Open" },
      { kind: "state", id: "closed", label: "Closed" },
    ],
    transitions: [
      { id: "t1", source: "start", target: "open" },
      {
        id: "t2",
        source: "open",
        target: "closed",
        trigger: "ev-resolve",
        guard: "fixed",
        effect: "act-notify",
      },
    ],
    fragments: [],
    projections: [],
  });

  test("labels a transition with its event, guard and effect", async () => {
    const flow = {
      notation: "stateMachine",
      view: toStateMachine(ticket, "ticket"),
    } as const;
    const { engine } = stubEngine();
    const placement = await layout(flow.view, { engine });
    const statuses = deriveStatuses(ticket, {}, noFacts);
    const { nodes, edges } = toFlow(flow, placement, {
      model: ticket,
      statuses,
      criticalPath: [],
      blockers: new Map(),
      shown: new Set(statuses.keys()),
      direction: "down",
    });

    expect(nodes.map((node) => node.id)).toEqual(["start", "open", "closed"]);
    expect(edges.map((edge) => edge.data?.label)).toEqual([
      undefined,
      "resolve [fixed] / notify",
    ]);
    expect(nodes[1]?.targetPosition).toBe("top");
  });
});
