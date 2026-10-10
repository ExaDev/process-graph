import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { exitCodes, nodePorts, runCli } from "../dist/index.js";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

/** Runs the built bin as a child process and waits for it. */
const runBin = (args: readonly string[], data: string) =>
  spawnSync(process.execPath, [bin, ...args], {
    env: { ...process.env, PROCESS_GRAPH_DATA: data },
    encoding: "utf8",
  });

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "process-graph-cli-smoke-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("the built library runs a command against a SQLite file through the Node ports", async () => {
  let stdout = "";
  const ports = nodePorts({
    env: { PROCESS_GRAPH_DATA: join(directory, "graph.sqlite3") },
    stdout: (text) => {
      stdout += text;
    },
  });
  const identity = { name: "process-graph-cli", version: "0.0.0" };

  await expect(
    runCli(["add", "activity", "build", "Build"], ports, identity),
  ).resolves.toBe(exitCodes.success);
  await expect(runCli(["ready"], ports, identity)).resolves.toBe(
    exitCodes.success,
  );
  expect(stdout).toBe("added activity build at revision 1\nbuild\tBuild\n");
});

test("the built bin runs as a process, creating its data directory, and reports its exit status", () => {
  const data = join(directory, "nested", "graph.sqlite3");

  expect(runBin(["add", "activity", "build", "Build"], data).status).toBe(
    exitCodes.success,
  );
  const ready = runBin(["ready", "--json"], data);
  expect(ready.status).toBe(exitCodes.success);
  expect(JSON.parse(ready.stdout)).toEqual({
    elements: [{ id: "build", label: "Build" }],
  });
  expect(runBin(["blocked", "nothing"], data)).toMatchObject({
    status: exitCodes.notFound,
    stdout: "",
    stderr: 'no element "nothing" in the model\n',
  });
});
