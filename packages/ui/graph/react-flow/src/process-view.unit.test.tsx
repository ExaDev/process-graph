import type { LayoutEngine } from "@exadev/process-graph-layout";
import { noFacts, type Run } from "@exadev/process-graph-react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { ProcessFlow } from "./process-flow.tsx";
import { ProcessView } from "./process-view.tsx";
import type { OrderIds } from "./test-support/ids.ts";
import { order } from "./test-support/order.ts";
import { stubEngine } from "./test-support/stub-engine.ts";

afterEach(cleanup);

const run: Run<OrderIds> = { model: order, overlay: {}, facts: noFacts };

describe("ProcessView", () => {
  test("draws a sequence projection as an SVG sequence diagram named by the label", () => {
    render(
      <ProcessView
        run={run}
        projection={{
          id: "p-seq",
          notation: "sequence",
          scenario: ["t1", "t2", "t3", "t4", "t5", "t7"],
        }}
        label="Order shipped"
      />,
    );

    const figure = screen.getByRole("figure", { name: "Order shipped" });
    expect(
      [...figure.querySelectorAll("[data-lifeline]")].map(
        (line) => line.textContent,
      ),
    ).toEqual(["Customer", "Shop", "Payment provider"]);
  });

  test("draws any other projection on the canvas", async () => {
    const { engine } = stubEngine();
    const layout = { engine };
    const { container } = render(
      <ProcessView
        run={run}
        projection={{ id: "p-flow", notation: "flowchart" }}
        label="Order process"
        layout={layout}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".react-flow__node")).toHaveLength(
        order.elements.length,
      );
    });
  });
});

describe("ProcessFlow filtering and failure", () => {
  test("hides the elements a filter leaves out, with their edges", async () => {
    const { engine } = stubEngine();
    const layout = { engine };
    const filter = {
      statuses: new Set(["ready"] as const),
      actors: new Set<string>(),
      sources: new Set<string>(),
    };
    const { container } = render(
      <ProcessFlow
        run={{ ...run, overlay: { "a-submit": "done" } }}
        projection={{ id: "p-flow", notation: "flowchart" }}
        label="Order process"
        layout={layout}
        filter={filter}
      />,
    );

    await waitFor(() => {
      expect(
        [...container.querySelectorAll(".react-flow__node")].map((node) =>
          node.getAttribute("data-id"),
        ),
      ).toEqual(["a-request"]);
    });
    expect(container.querySelectorAll("[data-transitions]")).toHaveLength(0);
  });

  test("throws a layout that fails to the nearest error boundary", async () => {
    const failure = new Error("no room");
    const engine: LayoutEngine = {
      arrange: async () => Promise.reject(failure),
    };
    const layout = { engine };
    const root = createRoot(document.createElement("div"));

    // act rethrows what a render inside it threw, as an error boundary would receive it.
    await expect(
      act(async () => {
        root.render(
          <ProcessFlow
            run={run}
            projection={{ id: "p-flow", notation: "flowchart" }}
            label="Order process"
            layout={layout}
          />,
        );
        await new Promise((resolve) => {
          setTimeout(resolve);
        });
      }),
    ).rejects.toMatchObject({
      message: "Order process could not be laid out",
      cause: failure,
    });
    root.unmount();
  });
});
