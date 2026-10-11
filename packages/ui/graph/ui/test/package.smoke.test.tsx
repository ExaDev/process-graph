import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map, a build that left Vanilla Extract calls in the JavaScript, or a stylesheet the build failed to emit.
import {
  GraphTheme,
  StatusBadge,
  darkTheme,
  darkValues,
  lightTheme,
  lightValues,
  vars,
} from "../dist/index.js";
import * as theme from "../dist/theme.js";

afterEach(cleanup);

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    join(import.meta.dirname, "../dist/style.css"),
    "utf8",
  );
  document.head.append(style);
});

test("the built package's components take their colours from the compiled stylesheet", () => {
  render(
    <GraphTheme theme="light">
      <StatusBadge status="blocked" />
    </GraphTheme>,
  );

  expect(getComputedStyle(screen.getByText("Blocked")).color).toBe(
    lightValues.colour.status.blocked,
  );
});

test("the built theme entry carries the same contract, classes and values as the components' entry, and only those", () => {
  expect({ ...theme }).toEqual({
    vars,
    lightTheme,
    darkTheme,
    lightValues,
    darkValues,
  });
  expect(theme.vars.colour.status.blocked).toMatch(/^var\(--/);
});
