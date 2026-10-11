import { explainStatus } from "@exadev/process-graph-domain";
import { toSequence } from "@exadev/process-graph-projection";
import { noFacts } from "@exadev/process-graph-react";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
import {
  DetailPanel,
  ElementCard,
  FilterPanel,
  GraphTheme,
  Lane,
  Legend,
  StatusBadge,
  TransitionItem,
  type ThemeName,
} from "./components.tsx";
import { SequenceDiagram } from "./sequence-diagram.tsx";
import { elementOf } from "./test-support/elements.ts";
import { order } from "./test-support/order.ts";
import { darkValues, lightValues, type ThemeValues } from "./theme-values.ts";
import { vars } from "./theme.css.ts";

afterEach(cleanup);

/** A tree of strings, the shape of the theme contract and of a theme's values. */
interface Tree {
  readonly [key: string]: string | Tree;
}

/**
 * Every leaf of a tree with the path that reaches it.
 */
const leaves = (
  tree: Tree,
  path: readonly string[] = [],
): (readonly [readonly string[], string])[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[[...path, key], value] as const]
      : leaves(value, [...path, key]),
  );

const at = (tree: Tree, path: readonly string[]): string | undefined => {
  let node: string | Tree | undefined = tree;
  for (const key of path) {
    node = typeof node === "object" ? node[key] : undefined;
  }

  return typeof node === "string" ? node : undefined;
};

/** The custom property a contract value refers to: `var(--name)` names `--name`. */
const propertyOf = (reference: string): string => {
  const match = /^var\((--[^)]+)\)$/.exec(reference);
  if (match?.[1] === undefined) {
    throw new Error(`${reference} is not a var() reference`);
  }

  return match[1];
};

const valuesOf: Readonly<Record<ThemeName, ThemeValues>> = {
  light: lightValues,
  dark: darkValues,
};

const pending = { "a-submit": "done" } as const;

/** Each component this package styles, rendered with the order fixture. */
const components: Readonly<Record<string, () => ReactElement>> = {
  StatusBadge: () => <StatusBadge status="ready" />,
  ElementCard: () => (
    <ElementCard
      element={elementOf("a-request")}
      status="ready"
      critical
      blockedBy={[{ id: "a-submit", label: "Submit order" }]}
    />
  ),
  TransitionItem: () => (
    <ul>
      <TransitionItem
        id="t2"
        from="Submit order"
        to="Request payment"
        handoff
      />
    </ul>
  ),
  Lane: () => <Lane participant="shop" label="Shop" />,
  Legend: () => <Legend critical />,
  FilterPanel: () => (
    <FilterPanel
      filter={{ statuses: new Set(), actors: new Set(), sources: new Set() }}
      options={{ actors: [], sources: [] }}
      onToggleStatus={() => {}}
      onToggleActor={() => {}}
      onToggleSource={() => {}}
      onClear={() => {}}
    />
  ),
  DetailPanel: () => (
    <DetailPanel
      element={elementOf("a-authorise")}
      explanation={explainStatus(order, pending, noFacts, "a-authorise")}
      blockers={["a-request"]}
      impact={["d-authorised"]}
      labelOf={(id) => id}
    />
  ),
  SequenceDiagram: () => (
    <SequenceDiagram
      diagram={toSequence(order, ["t2", "t3", "t4"])}
      labelOf={(actor) => actor}
      title="Payment"
    />
  ),
};

describe.each(["light", "dark"] as const)("the %s theme", (theme) => {
  test.each(Object.keys(components))(
    "%s renders with every contract variable resolved to the theme's value",
    (name) => {
      const Component = components[name];
      if (Component === undefined) {
        throw new Error(`no component ${name}`);
      }
      render(
        <GraphTheme theme={theme}>
          <Component />
        </GraphTheme>,
      );

      const root = document.querySelector(`[data-theme="${theme}"]`);
      if (!(root instanceof HTMLElement) || root.firstElementChild === null) {
        throw new Error(`${name} rendered nothing under the theme`);
      }
      const style = getComputedStyle(root);
      for (const [path, reference] of leaves(vars)) {
        expect(
          style.getPropertyValue(propertyOf(reference)).trim(),
          path.join("."),
        ).toBe(at(valuesOf[theme], path));
      }
    },
  );
});

describe.each(["light", "dark"] as const)(
  "status colours in the %s theme",
  (theme) => {
    test.each(["done", "ready", "blocked", "skipped", "unknown"] as const)(
      "a %s badge is drawn in the status colour",
      (status) => {
        render(
          <GraphTheme theme={theme}>
            <StatusBadge status={status} />
          </GraphTheme>,
        );
        const badge = document.querySelector(`[data-status="${status}"]`);
        if (badge === null) {
          throw new Error("no badge");
        }

        expect(getComputedStyle(badge).color).toBe(
          valuesOf[theme].colour.status[status],
        );
      },
    );
  },
);
