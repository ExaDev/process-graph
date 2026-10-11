import { toSwimlane } from "@exadev/process-graph-projection";
import { noFacts, type Run } from "@exadev/process-graph-react";
import type { Overlay } from "@exadev/process-graph-schema";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProcessFlow } from "./process-flow.tsx";
import type { OrderIds } from "./test-support/ids.ts";
import { order } from "./test-support/order.ts";
import { stubEngine } from "./test-support/stub-engine.ts";

afterEach(cleanup);

const submitted: Overlay<OrderIds> = { "a-submit": "done" };
const run: Run<OrderIds> = { model: order, overlay: submitted, facts: noFacts };
const swimlane = { id: "p-lanes", notation: "swimlane" } as const;

const renderSwimlane = (onSelect?: (id: string | undefined) => void) => {
  const { engine } = stubEngine();
  const layout = { engine };

  return render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessFlow
        run={run}
        projection={swimlane}
        label="Order process"
        layout={layout}
        onSelect={onSelect}
      />
    </div>,
  );
};

const nodeOf = (container: HTMLElement, id: string): HTMLElement => {
  const node = container.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(node instanceof HTMLElement)) {
    throw new Error(`no node ${id}`);
  }

  return node;
};

describe("ProcessFlow", () => {
  test("says it is laying out until the layout resolves", async () => {
    renderSwimlane();

    expect(screen.getByRole("status").textContent).toBe(
      "Laying out Order process",
    );
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  test("draws the lanes and each element's card with its status", async () => {
    const { container } = renderSwimlane();

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__node")).toHaveLength(
        order.elements.length + toSwimlane(order).lanes.length,
      );
    });
    const lanes = [...container.querySelectorAll("[data-lane]")];
    expect(lanes.map((lane) => lane.textContent)).toEqual([
      "Customer",
      "Shop",
      "Payment provider",
    ]);
    expect(
      within(nodeOf(container, "a-submit")).getByText("Done"),
    ).toBeTruthy();
    expect(
      within(nodeOf(container, "a-request")).getByText("Ready"),
    ).toBeTruthy();
    expect(
      within(nodeOf(container, "a-pack")).getByText(
        "Blocked by Request payment",
      ),
    ).toBeTruthy();
  });

  test("marks the critical path on its cards", async () => {
    const { container } = renderSwimlane();

    await waitFor(() => {
      expect(
        nodeOf(container, "a-request").querySelector("[data-critical]"),
      ).not.toBeNull();
    });
    expect(
      nodeOf(container, "a-cancel").querySelector("[data-critical]"),
    ).toBeNull();
  });

  test("draws the hand-offs and the critical steps as marked edges with their labels", async () => {
    const { container } = renderSwimlane();

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-transitions]").length,
      ).toBeGreaterThan(0);
    });
    const edges = [...container.querySelectorAll("[data-transitions]")];
    expect(
      edges
        .filter((edge) => edge.hasAttribute("data-handoff"))
        .map((edge) => edge.getAttribute("data-transitions")),
    ).toEqual(["t2", "t3", "t4"]);
    expect(
      edges
        .filter((edge) => edge.hasAttribute("data-critical"))
        .map((edge) => edge.getAttribute("data-transitions")),
    ).toEqual(["t3", "t4", "t5", "t7"]);
    const authorised = edges.find(
      (edge) => edge.getAttribute("data-transitions") === "t5",
    );
    expect(authorised?.textContent).toBe("authorised");
  });

  test("selects an element on click and tells the listener", async () => {
    const onSelect = vi.fn<(id: string | undefined) => void>();
    const { container } = renderSwimlane(onSelect);
    await waitFor(() => {
      nodeOf(container, "a-pack");
    });

    fireEvent.click(nodeOf(container, "a-pack"));

    expect(onSelect).toHaveBeenLastCalledWith("a-pack");
    expect(nodeOf(container, "a-pack").classList.contains("selected")).toBe(
      true,
    );
  });

  test("moves the selection and focus with the arrow keys", async () => {
    const onSelect = vi.fn<(id: string | undefined) => void>();
    const { container } = renderSwimlane(onSelect);
    await waitFor(() => {
      nodeOf(container, "start");
    });
    const canvas = screen.getByLabelText("Order process");

    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    fireEvent.keyDown(canvas, { key: "ArrowDown" });

    expect(onSelect.mock.calls).toEqual([["start"], ["a-submit"]]);
    expect(document.activeElement).toBe(nodeOf(container, "a-submit"));
  });
});
