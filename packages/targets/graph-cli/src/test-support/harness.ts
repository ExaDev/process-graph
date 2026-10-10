import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openNodeGraphStore } from "@exadev/process-graph-sqlite-node";
import {
  createFakeGraphSource,
  createGraphSourceRouter,
  type GraphSourcePager,
} from "@exadev/process-graph-source-contract";
import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import type { ExitCode } from "../exit-codes.ts";
import type { CliPorts } from "../ports.ts";
import { runCli } from "../program.ts";
import { githubLikeSource } from "./fixtures.ts";

/** What one run of the command line wrote and returned. */
export interface Run {
  readonly code: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

/** A command line wired to a SQLite file in a fresh directory and an in-memory source, run as a function. */
export interface Harness {
  /** The data file the store keeps; the default data path. */
  readonly dataPath: string;
  /** The directory holding it, for other files a test writes. */
  readonly directory: string;
  /** Runs the command line with these arguments. */
  readonly run: (...args: readonly string[]) => Promise<Run>;
  /** Removes the directory. */
  readonly remove: () => void;
}

/**
 * Builds a harness whose sources serve their pages through the real oRPC router, and whose store is `node:sqlite` on a file, so every command runs exactly as it does in a process apart from the streams.
 * @param pagers - The sources, each serving the scopes with its prefix; the fixture's `github` fake when none is given.
 * @returns The harness.
 */
export const createHarness = (
  ...pagers: readonly GraphSourcePager[]
): Harness => {
  const sources =
    pagers.length === 0 ? [createFakeGraphSource(githubLikeSource)] : pagers;
  const directory = mkdtempSync(join(tmpdir(), "process-graph-cli-"));
  const dataPath = join(directory, "graph.sqlite3");

  return {
    dataPath,
    directory,
    run: async (...args) => {
      let stdout = "";
      let stderr = "";
      const ports: CliPorts = {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
        defaultDataPath: dataPath,
        openStore: (path) => {
          const { store, close } = openNodeGraphStore(path);

          return {
            client: createRouterClient(createGraphStoreRouter(store)),
            close,
          };
        },
        source: (prefix) => {
          const pager = sources.find(
            (candidate) => candidate.source === prefix,
          );

          return pager === undefined
            ? undefined
            : createRouterClient(createGraphSourceRouter(pager));
        },
        readFile: async (path) => readFile(path, "utf8"),
        facts: () => ({ found: false }),
        signal: undefined,
      };
      const code = await runCli(args, ports, {
        name: "process-graph",
        version: "0.0.0-test",
      });

      return { code, stdout, stderr };
    },
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
};

/**
 * Runs commands one after another, each after the one before has finished, since each reads what the one before wrote.
 * @param harness - The harness to run them in.
 * @param commands - The argument lists, in order.
 * @returns Each run's result, in order.
 */
export const runInOrder = async (
  harness: Harness,
  commands: readonly (readonly string[])[],
): Promise<readonly Run[]> => {
  const [first, ...rest] = commands;
  if (first === undefined) {
    return [];
  }
  const result = await harness.run(...first);

  return [result, ...(await runInOrder(harness, rest))];
};
