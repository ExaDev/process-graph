import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { card } from "./components.css.ts";
import {
  ElementCard,
  GraphTheme,
  Legend,
  TransitionItem,
} from "./components.tsx";
import { elementOf } from "./test-support/elements.ts";
import { lightValues } from "./theme-values.ts";

afterEach(cleanup);

const request = elementOf("a-request");

describe("the styled components", () => {
  test("an element card takes the recipe's classes for its status, kind and critical path", () => {
    render(
      <GraphTheme theme="light">
        <ElementCard element={request} status="blocked" critical />
      </GraphTheme>,
    );

    const root = document.querySelector('[data-element-id="a-request"]');
    expect(root?.className).toBe(
      card({ status: "blocked", kind: "activity", critical: true }),
    );
    expect(root?.className).not.toBe(
      card({ status: "ready", kind: "activity", critical: true }),
    );
  });

  test("an element card's leading edge is drawn in its status colour", () => {
    render(
      <GraphTheme theme="light">
        <ElementCard element={request} status="ready" />
      </GraphTheme>,
    );

    const root = document.querySelector('[data-element-id="a-request"]');
    if (root === null) {
      throw new Error("no card");
    }
    expect(getComputedStyle(root).borderLeftColor).toBe(
      lightValues.colour.status.ready,
    );
  });

  test("each legend swatch is coloured by its status", () => {
    render(
      <GraphTheme theme="light">
        <Legend critical />
      </GraphTheme>,
    );

    const swatches = [...document.querySelectorAll('[data-part="swatch"]')];
    expect(
      swatches.map((swatch) => getComputedStyle(swatch).backgroundColor),
    ).toEqual([
      lightValues.colour.status.done,
      lightValues.colour.status.unknown,
      lightValues.colour.status.skipped,
      lightValues.colour.status.ready,
      lightValues.colour.status.blocked,
      lightValues.colour.critical,
    ]);
  });

  test("a hand-off is drawn in the hand-off colour", () => {
    render(
      <GraphTheme theme="light">
        <ul>
          <TransitionItem
            id="t2"
            from="Submit order"
            to="Request payment"
            handoff
          />
        </ul>
      </GraphTheme>,
    );

    expect(getComputedStyle(screen.getByRole("listitem")).color).toBe(
      lightValues.colour.handoff,
    );
  });
});
