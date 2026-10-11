import { statuses } from "@exadev/process-graph-domain";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GraphTheme, StatusBadge } from "./components.tsx";
import { vars } from "./theme.css.ts";

afterEach(cleanup);

/**
 * WCAG 2.2 success criterion 1.4.3, Contrast (Minimum): text and images of text need a contrast ratio of at least 4.5:1. A status is shown as text in its colour, so each status colour must reach it against every surface it is drawn on. https://www.w3.org/TR/WCAG22/#contrast-minimum
 */
const minimumTextContrast = 4.5;

/** The constants of WCAG 2.2's relative luminance: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance */
const srgb = {
  /** The largest value of an 8-bit channel. */
  channelMaximum: 255,
  /** At or below this, a channel's linear value is proportional to it. */
  linearThreshold: 0.04045,
  linearSlope: 12.92,
  offset: 0.055,
  scale: 1.055,
  exponent: 2.4,
  /** Each channel's share of the luminance. */
  weights: { red: 0.2126, green: 0.7152, blue: 0.0722 },
};

/** A `#rrggbb` channel is written in base sixteen. */
const hexadecimal = 16;

/** The flare WCAG 2.2's contrast ratio adds to both luminances: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio */
const flare = 0.05;

const linear = (channel: number): number => {
  const value = channel / srgb.channelMaximum;

  return value <= srgb.linearThreshold
    ? value / srgb.linearSlope
    : ((value + srgb.offset) / srgb.scale) ** srgb.exponent;
};

/** The relative luminance of a `#rrggbb` colour, by the WCAG 2.2 definition. */
const luminance = (colour: string): number => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(colour);
  if (match === null) {
    throw new Error(`${colour} is not a #rrggbb colour`);
  }
  const [red, green, blue] = match
    .slice(1)
    .map((hex) => linear(Number.parseInt(hex, hexadecimal)));
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`${colour} lacks a channel`);
  }

  return (
    srgb.weights.red * red +
    srgb.weights.green * green +
    srgb.weights.blue * blue
  );
};

/** The contrast ratio of two colours, by the WCAG 2.2 definition: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio */
const contrast = (first: string, second: string): number => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  if (lighter === undefined || darker === undefined) {
    throw new Error("two colours are needed");
  }

  return (lighter + flare) / (darker + flare);
};

/** The value a contract variable resolves to on the rendered theme root. */
const resolved = (root: Element, reference: string): string => {
  const property = /^var\((--[^)]+)\)$/u.exec(reference)?.[1];
  if (property === undefined) {
    throw new Error(`${reference} is not a var() reference`);
  }

  return getComputedStyle(root).getPropertyValue(property).trim();
};

describe.each(["light", "dark"] as const)(
  "the %s theme's status colours",
  (theme) => {
    const rendered = () => {
      render(
        <GraphTheme theme={theme}>
          {statuses.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </GraphTheme>,
      );
      const root = document.querySelector(`[data-theme="${theme}"]`);
      if (root === null) {
        throw new Error("no theme root");
      }

      return root;
    };

    test.each(statuses)(
      "%s text reaches the minimum contrast on the background and on a surface",
      (status) => {
        const root = rendered();
        const badge = root.querySelector(`[data-status="${status}"]`);
        if (badge === null) {
          throw new Error(`no ${status} badge`);
        }
        const colour = getComputedStyle(badge).color;

        for (const behind of [vars.colour.background, vars.colour.surface]) {
          expect(
            contrast(colour, resolved(root, behind)),
          ).toBeGreaterThanOrEqual(minimumTextContrast);
        }
      },
    );

    test("every status has a colour of its own", () => {
      const root = rendered();
      const colours = statuses.map((status) =>
        resolved(root, vars.colour.status[status]),
      );

      expect(new Set(colours).size).toBe(statuses.length);
    });

    test("the critical path and hand-off marks reach the minimum contrast on a surface", () => {
      const root = rendered();
      const surface = resolved(root, vars.colour.surface);

      for (const mark of [vars.colour.critical, vars.colour.handoff]) {
        expect(contrast(resolved(root, mark), surface)).toBeGreaterThanOrEqual(
          minimumTextContrast,
        );
      }
    });
  },
);
