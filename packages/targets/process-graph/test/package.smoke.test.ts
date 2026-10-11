import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exitCodes } from "@exadev/process-graph-cli/exit-codes";
import { describe, expect, inject, test } from "vitest";

// Every test here runs against the packed tarball installed into a throwaway project by `consumer.global-setup.ts`, never against src/ or the workspace: this is the check that catches a wrong exports map, a declaration or import that still names a private workspace package, or a manifest that ships a specifier no consumer can install.
const consumer = inject("consumer");
const installed = join(consumer, "node_modules", "process-graph");

/**
 * Runs an ES module in the consumer's project, as a consumer's own code would run, and parses the JSON it prints.
 * @param source - The module's source; it prints one JSON document.
 * @param project - The project to run it in; the one with every peer installed when absent.
 * @returns The printed document.
 */
const evaluate = (source: string, project: string = consumer): unknown => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { cwd: project, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  const printed: unknown = JSON.parse(result.stdout);

  return printed;
};

/** A two-actor model, the same in every test that needs one. */
const model = `{
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
}`;

/** Every file under a directory, recursively. */
const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

describe("the packed package", () => {
  test("ships no protocol specifier in its manifest", () => {
    const manifest = readFileSync(join(installed, "package.json"), "utf8");

    expect(manifest).not.toMatch(/"(?:catalog|workspace):/);
  });

  test("names no private workspace package in any file it ships", () => {
    const naming = filesUnder(join(installed, "dist")).filter((file) =>
      readFileSync(file, "utf8").includes("@exadev/process-graph-"),
    );

    expect(naming).toEqual([]);
  });

  test.each([
    {
      subpath: "process-graph/ui/style.css",
      holding: "a rule",
      rule: /\{[^}]+\}/,
    },
    {
      subpath: "process-graph/react-flow/style.css",
      holding: "React Flow's own rules",
      rule: /\.react-flow/,
    },
  ])(
    "ships $subpath, resolvable through its subpath and holding $holding",
    ({ subpath, rule }) => {
      const stylesheet = evaluate(`
      import { readFileSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      console.log(JSON.stringify(readFileSync(fileURLToPath(import.meta.resolve("${subpath}")), "utf8")));
    `);

      expect(typeof stylesheet === "string" && rule.test(stylesheet)).toBe(
        true,
      );
    },
  );
});

describe("each subpath, imported from the installed package", () => {
  test("process-graph loads a model, projects it and derives its status", () => {
    expect(
      evaluate(`
        import { dag, deriveStatuses, parseModel, readySet, toSwimlane } from "process-graph";
        const model = parseModel(${model});
        const facts = () => ({ found: false });
        console.log(JSON.stringify({
          lanes: toSwimlane(model).lanes.map((lane) => [lane.participant, lane.nodes]),
          statuses: [...deriveStatuses(model, { submit: "done" }, facts)],
          ready: readySet(model, {}, facts),
          layers: dag.topologicalLayers(dag.buildDag(["a", "b"], (id) => (id === "b" ? ["a"] : []))).layers,
        }));
      `),
    ).toEqual({
      lanes: [
        ["customer", ["submit"]],
        ["shop", ["pack"]],
      ],
      statuses: [
        ["submit", "done"],
        ["pack", "ready"],
      ],
      ready: ["submit"],
      layers: [["a"], ["b"]],
    });
  });

  test("process-graph/layout places a projected flowchart", () => {
    expect(
      evaluate(`
        import { parseModel, toFlowchart } from "process-graph";
        import { layout } from "process-graph/layout";
        const placed = await layout(toFlowchart(parseModel(${model})));
        console.log(JSON.stringify(Object.keys(placed.sizes).sort()));
      `),
    ).toEqual(expect.arrayContaining(["pack", "submit"]));
  });

  test("process-graph/source/github and its node entry build a GitHub source and its token port", () => {
    expect(
      evaluate(`
        import { createFakeGraphSource, createGitHubIssuesSource, graphSourceContract } from "process-graph/source/github";
        import { githubTokenFromEnvironment } from "process-graph/source/github/node";
        console.log(JSON.stringify({
          adapter: typeof createGitHubIssuesSource,
          fake: typeof createFakeGraphSource,
          contract: typeof graphSourceContract,
          token: await githubTokenFromEnvironment({ env: { GITHUB_TOKEN: "example-token" } })(),
        }));
      `),
    ).toEqual({
      adapter: "function",
      fake: "function",
      contract: "object",
      token: "example-token",
    });
  });

  test("process-graph/store and process-graph/store/node save and load a model on node:sqlite", () => {
    expect(
      evaluate(`
        import { createGraphStoreRouter } from "process-graph/store";
        import { openNodeGraphStore } from "process-graph/store/node";
        import { parseModel } from "process-graph";
        const { store, close } = openNodeGraphStore(":memory:");
        await store.saveModel({ modelId: "orders", model: parseModel(${model}), signal: undefined });
        const loaded = await store.loadModel({ modelId: "orders", signal: undefined });
        close();
        console.log(JSON.stringify({
          router: typeof createGraphStoreRouter(store),
          elements: loaded.model.elements.map((element) => element.id),
        }));
      `),
    ).toEqual({ router: "object", elements: ["submit", "pack"] });
  });

  test("process-graph/store/wasm and its worker entry resolve to the page and worker halves", () => {
    expect(
      evaluate(`
        import { connectGraphStore } from "process-graph/store/wasm";
        import { serveGraphStoreInWorker } from "process-graph/store/wasm/worker";
        console.log(JSON.stringify([typeof connectGraphStore, typeof serveGraphStoreInWorker]));
      `),
    ).toEqual(["function", "function"]);
  });

  test("process-graph/sync syncs a source into a store, its relations included", () => {
    expect(
      evaluate(`
        import { createRouterClient } from "@orpc/server";
        import { createFakeGraphSource, createGraphSourceRouter } from "process-graph/source/github";
        import { createFakeGraphStore, createGraphStoreRouter } from "process-graph/store";
        import { syncScopes } from "process-graph/sync";
        const activity = (id, label) => ({ kind: "activity", id, source: id, label, actor: "fake:team" });
        const source = createRouterClient(createGraphSourceRouter(createFakeGraphSource({
          source: "fake",
          scopes: {
            "fake:team": [{
              participants: [{ id: "fake:team", label: "team", kind: "system" }],
              activities: [activity("fake:1", "Parent"), activity("fake:2", "Child")],
              transitions: [],
              relations: [{ kind: "child-of", from: "fake:2", to: "fake:1" }],
              overlay: {},
              gaps: [],
            }],
          },
        })));
        const store = createRouterClient(createGraphStoreRouter(createFakeGraphStore()));
        const result = await syncScopes({ store, sources: () => source, modelId: "team", scopes: ["fake:team"] });
        const { children } = await store.v1.query.children({ modelId: "team", element: "fake:1" });
        console.log(JSON.stringify({ relations: result.relations, children }));
      `),
    ).toEqual({ relations: 1, children: ["fake:2"] });
  });

  test("process-graph/react, ui and react-flow are separate subpaths, the styled components apart from the headless ones", () => {
    expect(
      evaluate(`
        import * as react from "process-graph/react";
        import * as ui from "process-graph/ui";
        import { ProcessFlow, toFlow } from "process-graph/react-flow";
        console.log(JSON.stringify({
          hook: typeof react.useModel,
          theme: typeof ui.GraphTheme,
          flow: [typeof ProcessFlow, typeof toFlow],
          distinctCards: react.ElementCard !== ui.ElementCard,
        }));
      `),
    ).toEqual({
      hook: "function",
      theme: "function",
      flow: ["function", "function"],
      distinctCards: true,
    });
  });

  test("process-graph/package.json and process-graph/cli's version name the installed package's version", () => {
    const installedManifest: unknown = JSON.parse(
      readFileSync(join(installed, "package.json"), "utf8"),
    );
    if (
      typeof installedManifest !== "object" ||
      installedManifest === null ||
      !("version" in installedManifest) ||
      typeof installedManifest.version !== "string"
    ) {
      throw new Error("the installed manifest has no version");
    }

    expect(
      evaluate(`
        import manifest from "process-graph/package.json" with { type: "json" };
        import { version } from "process-graph/cli";
        console.log(JSON.stringify({ name: manifest.name, manifest: manifest.version, cli: version }));
      `),
    ).toEqual({
      name: "process-graph",
      manifest: installedManifest.version,
      cli: installedManifest.version,
    });
  });

  test("process-graph/cli runs a command through the Node ports", () => {
    expect(
      evaluate(`
        import { mkdtempSync, rmSync } from "node:fs";
        import { tmpdir } from "node:os";
        import { join } from "node:path";
        import { exitCodes, nodePorts, runCli } from "process-graph/cli";
        const directory = mkdtempSync(join(tmpdir(), "process-graph-cli-"));
        let stdout = "";
        const ports = nodePorts({
          env: { PROCESS_GRAPH_DATA: join(directory, "graph.sqlite3") },
          stdout: (text) => { stdout += text; },
        });
        const identity = { name: "process-graph", version: "0.0.0" };
        const added = await runCli(["add", "activity", "build", "Build"], ports, identity);
        const ready = await runCli(["ready"], ports, identity);
        rmSync(directory, { recursive: true, force: true });
        console.log(JSON.stringify({ added: added === exitCodes.success, ready: ready === exitCodes.success, stdout }));
      `),
    ).toEqual({
      added: true,
      ready: true,
      stdout: "added activity build at revision 1\nbuild\tBuild\n",
    });
  });
});

describe("process-graph/ui/theme, in a project with none of the optional peers", () => {
  test("imports without React, and carries the same contract and values as process-graph/ui", () => {
    const bareConsumer = inject("bareConsumer");
    const theme = `
      import * as theme from "process-graph/ui/theme";
      const resolves = (name) => { try { import.meta.resolve(name); return true; } catch { return false; } };
      console.log(JSON.stringify({ react: resolves("react"), exports: Object.keys(theme).sort(), vars: theme.vars, light: theme.lightValues }));
    `;
    const bare = evaluate(theme, bareConsumer);
    const full = evaluate(`
      import { vars, lightValues } from "process-graph/ui";
      console.log(JSON.stringify({ vars, light: lightValues }));
    `);

    expect(bare).toMatchObject({
      react: false,
      exports: ["darkTheme", "darkValues", "lightTheme", "lightValues", "vars"],
    });
    if (typeof full !== "object" || full === null) {
      throw new Error("process-graph/ui printed no theme");
    }
    expect(bare).toMatchObject(full);
  });
});

describe("the installed bin", () => {
  const bin = join(consumer, "node_modules", ".bin", "process-graph");
  const manifest: unknown = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  const version =
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
      ? manifest.version
      : undefined;

  test("prints the command line's help", () => {
    const help = spawnSync(bin, ["--help"], {
      cwd: consumer,
      encoding: "utf8",
    });

    expect(help).toMatchObject({ status: 0 });
    expect(help.stdout).toContain("Usage: process-graph [options] [command]");
  });

  test("reports the package's version", () => {
    expect(
      spawnSync(bin, ["--version"], { cwd: consumer, encoding: "utf8" }),
    ).toMatchObject({ status: 0, stdout: `${String(version)}\n` });
  });
});

describe("the installed bin without its optional peers", () => {
  const bareConsumer = inject("bareConsumer");
  const bin = join(bareConsumer, "node_modules", ".bin", "process-graph");
  const installedManifest: unknown = JSON.parse(
    readFileSync(
      join(bareConsumer, "node_modules", "process-graph", "package.json"),
      "utf8",
    ),
  );
  if (
    typeof installedManifest !== "object" ||
    installedManifest === null ||
    !("peerDependencies" in installedManifest) ||
    typeof installedManifest.peerDependencies !== "object" ||
    installedManifest.peerDependencies === null
  ) {
    throw new Error("the installed manifest declares no peerDependencies");
  }
  const peers = new Map(Object.entries(installedManifest.peerDependencies));
  const commandLinePeers = [
    "@orpc/client",
    "@orpc/contract",
    "@orpc/server",
    "commander",
    "drizzle-orm",
  ];
  const specifiers = commandLinePeers
    .map((name) => `${name}@${String(peers.get(name))}`)
    .join(" ");
  const named = `process-graph: the command line needs these optional peer dependencies, which are not installed: ${commandLinePeers.join(", ")}.`;

  test.each([
    {
      manager: "no package manager",
      userAgent: undefined,
      command: "npm install",
    },
    {
      manager: "pnpm",
      userAgent: "pnpm/12.4.1 npm/? node/v26.8.1 linux x64",
      command: "pnpm add",
    },
  ])(
    "run by $manager, names every missing peer and the $command that installs them, and exits with the missing-peers status and no stack trace",
    ({ userAgent, command }) => {
      // The inherited user agent is dropped, since the test runner itself runs under pnpm.
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name !== "npm_config_user_agent",
        ),
      );
      const result = spawnSync(bin, ["--help"], {
        cwd: bareConsumer,
        encoding: "utf8",
        env:
          userAgent === undefined
            ? environment
            : { ...environment, npm_config_user_agent: userAgent },
      });

      expect(result).toMatchObject({
        status: exitCodes.missingPeers,
        stdout: "",
        stderr: `${named}\nInstall them beside process-graph: ${command} ${specifiers}\n`,
      });
    },
  );
});
