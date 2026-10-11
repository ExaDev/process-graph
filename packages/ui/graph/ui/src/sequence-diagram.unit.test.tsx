import { toSequence } from "@exadev/process-graph-projection";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GraphTheme } from "./components.tsx";
import { SequenceDiagram } from "./sequence-diagram.tsx";
import { order } from "./test-support/order.ts";

afterEach(cleanup);

const labelOf = (actor: string): string => {
  const participant = order.participants.find((p) => p.id === actor);
  if (participant === undefined) {
    throw new Error(`no participant ${actor}`);
  }

  return participant.label;
};

/** The shipped path of the order process, as the model's declared sequence projection records it. */
const shipped = toSequence(order, ["t1", "t2", "t3", "t4", "t5", "t7"]);

const renderShipped = () =>
  render(
    <GraphTheme theme="light">
      <SequenceDiagram
        diagram={shipped}
        labelOf={labelOf}
        title="Order shipped"
      />
    </GraphTheme>,
  );

describe("SequenceDiagram", () => {
  test("is a figure named by its caption", () => {
    renderShipped();

    expect(screen.getByRole("figure", { name: "Order shipped" })).toBeTruthy();
  });

  test("draws a lifeline per actor, in order of first appearance, headed by its name", () => {
    const { container } = renderShipped();

    const lifelines = [...container.querySelectorAll("[data-lifeline]")];
    expect(lifelines.map((line) => line.getAttribute("data-lifeline"))).toEqual(
      ["customer", "shop", "provider"],
    );
    expect(lifelines.map((line) => line.textContent)).toEqual([
      "Customer",
      "Shop",
      "Payment provider",
    ]);
  });

  test("draws each message from its sender's lifeline to its receiver's, left to right in time order", () => {
    const { container } = renderShipped();

    const lines = [...container.querySelectorAll("[data-transition-id] line")];
    const ends = lines.map((line) => ({
      from: Number(line.getAttribute("x1")),
      to: Number(line.getAttribute("x2")),
      y: Number(line.getAttribute("y1")),
    }));
    const heads = new Map(
      [...container.querySelectorAll("[data-lifeline] line")].map((line) => [
        line.parentElement?.getAttribute("data-lifeline"),
        Number(line.getAttribute("x1")),
      ]),
    );
    expect(ends.map(({ from, to }) => [from, to])).toEqual([
      [heads.get("customer"), heads.get("shop")],
      [heads.get("shop"), heads.get("provider")],
      [heads.get("provider"), heads.get("shop")],
    ]);
    const rows = ends.map(({ y }) => y);
    expect(rows).toEqual(rows.toSorted((a, b) => a - b));
    expect(new Set(rows).size).toBe(rows.length);
  });

  test("draws a self-message as a loop on its lifeline", () => {
    const { container } = renderShipped();

    const self = container.querySelector('[data-transition-id="t5"]');
    expect(self?.querySelector("path")).not.toBeNull();
    expect(self?.textContent).toBe("payment authorised");
  });

  test("frames the decision's branch in an alt with its guard", () => {
    const { container } = renderShipped();

    const fragment = container.querySelector('[data-fragment="alt"]');
    expect(fragment?.textContent).toBe("alt[authorised]");
  });

  test("the drawing is hidden from assistive technology, which reads the steps as a list", () => {
    const { container } = renderShipped();

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    const figure = screen.getByRole("figure", { name: "Order shipped" });
    const steps = within(figure).getAllByRole("listitem");
    expect(steps.map((step) => step.firstChild?.textContent)).toEqual([
      "Customer to Shop: Request payment",
      "Shop to Payment provider: Authorise or decline",
      "Payment provider to Shop: Payment authorised?",
      "alt",
      "[authorised] ",
      "Shop to Shop: payment authorised",
    ]);
  });
});
