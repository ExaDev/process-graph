import * as cliPackage from "@exadev/process-graph-cli";
import * as layoutPackage from "@exadev/process-graph-layout";
import * as reactPackage from "@exadev/process-graph-react";
import * as reactFlowPackage from "@exadev/process-graph-react-flow";
import * as sourceContractPackage from "@exadev/process-graph-source-contract";
import * as githubIssuesPackage from "@exadev/process-graph-source-github-issues";
import * as githubIssuesNodePackage from "@exadev/process-graph-source-github-issues/node";
import * as sqliteNodePackage from "@exadev/process-graph-sqlite-node";
import * as storeContractPackage from "@exadev/process-graph-store-contract";
import * as storeSqlitePackage from "@exadev/process-graph-store-sqlite";
import * as uiPackage from "@exadev/process-graph-ui";
import { describe, expect, test } from "vitest";
import * as cliEntry from "./cli.ts";
import * as layoutEntry from "./layout.ts";
import * as reactFlowEntry from "./react-flow.ts";
import * as reactEntry from "./react.ts";
import * as githubEntry from "./source/github.ts";
import * as githubNodeEntry from "./source/github/node.ts";
import * as storeEntry from "./store.ts";
import * as storeNodeEntry from "./store/node.ts";
import * as uiEntry from "./ui.ts";

/** One subpath entry point and the bundled packages whose exports it carries flat. */
interface Subpath {
  readonly name: string;
  readonly entry: object;
  readonly layers: readonly (readonly [string, object])[];
}

// The browser store entries load SQLite's WebAssembly build and the Web APIs a worker uses, so their surface is checked in the browser integration test and against the built package in the smoke test, not here under Node.
const subpaths: readonly Subpath[] = [
  {
    name: "layout",
    entry: layoutEntry,
    layers: [["layout", layoutPackage]],
  },
  {
    name: "source/github",
    entry: githubEntry,
    layers: [
      ["source-contract", sourceContractPackage],
      ["source-github-issues", githubIssuesPackage],
    ],
  },
  {
    name: "source/github/node",
    entry: githubNodeEntry,
    layers: [["source-github-issues/node", githubIssuesNodePackage]],
  },
  {
    name: "store",
    entry: storeEntry,
    layers: [
      ["store-contract", storeContractPackage],
      ["store-sqlite", storeSqlitePackage],
    ],
  },
  {
    name: "store/node",
    entry: storeNodeEntry,
    layers: [["sqlite-node", sqliteNodePackage]],
  },
  {
    name: "react",
    entry: reactEntry,
    layers: [["react", reactPackage]],
  },
  {
    name: "ui",
    entry: uiEntry,
    layers: [["ui", uiPackage]],
  },
  {
    name: "react-flow",
    entry: reactFlowEntry,
    layers: [["react-flow", reactFlowPackage]],
  },
  {
    name: "cli",
    entry: cliEntry,
    layers: [["cli", cliPackage]],
  },
];

describe.each(subpaths)(
  "the process-graph/$name entry point",
  ({ entry, layers }) => {
    test("no name is exported by more than one of its layers", () => {
      const owners = new Map<string, string[]>();
      for (const [layer, exports] of layers) {
        for (const name of Object.keys(exports)) {
          owners.set(name, [...(owners.get(name) ?? []), layer]);
        }
      }
      const duplicates = [...owners]
        .filter(([, owning]) => owning.length > 1)
        .map(([name, owning]) => `${name}: ${owning.join(", ")}`);

      expect(duplicates).toEqual([]);
    });

    test("every runtime export of its layers is present and is the same value", () => {
      for (const [, exports] of layers) {
        for (const [name, value] of Object.entries(exports)) {
          expect(entry).toHaveProperty([name], value);
        }
      }
    });

    test("it exports its layers and nothing else", () => {
      const expected = layers.flatMap(([, exports]) => Object.keys(exports));

      expect(Object.keys(entry).sort()).toEqual(expected.sort());
    });
  },
);
