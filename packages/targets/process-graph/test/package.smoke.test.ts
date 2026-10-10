import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import {
  dag,
  deriveStatuses,
  parseModel,
  readySet,
  toSwimlane,
} from "../dist/index.js";

test("the built package loads a model, projects it and derives its status through one import", () => {
  const model = parseModel({
    participants: [
      { id: "customer", label: "Customer", kind: "role" },
      { id: "shop", label: "Shop", kind: "system" },
    ],
    events: [],
    actions: [],
    artefacts: [],
    elements: [
      { kind: "activity", id: "submit", label: "Submit", actor: "customer" },
      { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
    ],
    transitions: [{ id: "t1", source: "submit", target: "pack" }],
    fragments: [],
    projections: [],
  });
  const facts = () => ({ found: false }) as const;

  expect(
    toSwimlane(model).lanes.map((lane) => [lane.participant, lane.nodes]),
  ).toEqual([
    ["customer", ["submit"]],
    ["shop", ["pack"]],
  ]);
  expect([...deriveStatuses(model, { submit: "done" }, facts)]).toEqual([
    ["submit", "done"],
    ["pack", "ready"],
  ]);
  expect(readySet(model, {}, facts)).toEqual(["submit"]);
  expect(typeof dag.criticalPath).toBe("function");
});

test("the built process-graph bin runs the command line as a process with this package's version", () => {
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const version =
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
      ? manifest.version
      : undefined;

  const result = spawnSync(process.execPath, [bin, "--version"], {
    encoding: "utf8",
  });
  const help = spawnSync(process.execPath, [bin, "--help"], {
    encoding: "utf8",
  });

  expect(result).toMatchObject({ status: 0, stdout: `${String(version)}\n` });
  expect(help.stdout).toContain("Usage: process-graph [options] [command]");
});
