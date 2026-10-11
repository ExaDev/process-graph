import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Facts } from "@exadev/process-graph-domain";
import { createGraphSourceRouter } from "@exadev/process-graph-source-contract";
import {
  createGitHubIssuesSource,
  githubSource,
  type GitHubTokenPort,
  type GraphqlFetch,
} from "@exadev/process-graph-source-github-issues";
import { githubTokenFromEnvironment } from "@exadev/process-graph-source-github-issues/node";
import {
  openNodeGraphStore,
  prepareDataFile,
} from "@exadev/process-graph-sqlite-node";
import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import type { CliPorts } from "./ports.ts";
import type { ExitCode } from "./exit-codes.ts";
import { runCli, type ProgramIdentity } from "./program.ts";

/** Where a Node process finds its ports. Each is injectable, and each defaults to the real thing. */
export interface NodePortsOptions {
  /** The environment, for the data path and the GitHub token; `process.env` when absent. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The home directory the default data path falls back on; the user's when absent. */
  readonly home?: string;
  /**
   * A data file the host owns, such as one under its own home directory. It becomes the default data path in place of `PROCESS_GRAPH_DATA` and the XDG data file, and it gets the treatment the command line gives its own XDG data file: its directory, and any missing directories above it, are created readable by the owner only and kept that way, the database is created owner-only before SQLite opens it, and an existing store others can read is narrowed, with a warning on standard error (see `prepareDataFile` in `process-graph/store/node`). A path given with `--data` still wins, and is treated as the user's. The XDG data file when absent.
   */
  readonly dataPath?: string;
  /** Supplies GitHub tokens; `GITHUB_TOKEN` or the GitHub CLI's token (`githubTokenFromEnvironment`) when absent. */
  readonly token?: GitHubTokenPort;
  /** How requests reach GitHub; the global `fetch` when absent. */
  readonly fetch?: GraphqlFetch;
  /** The clock, in milliseconds since the epoch, for a rate limit's retry time; `Date.now` when absent. */
  readonly now?: () => number;
  /** Facts the host supplies for decision conditions and input artefacts, answering whatever the model's stored fact record does not; nothing more is known when absent. */
  readonly facts?: Facts;
  /** Aborts every store and source call. */
  readonly signal?: AbortSignal;
  /** Standard output; the process's when absent. */
  readonly stdout?: (text: string) => void;
  /** Standard error; the process's when absent. */
  readonly stderr?: (text: string) => void;
  /** The platform, which decides whether file modes are set; the process's when absent. */
  readonly platform?: NodeJS.Platform;
}

/** The variable that names the data file outright. */
const dataVariable = "PROCESS_GRAPH_DATA";

/** The data file's path under the data directory. */
const dataFile = join("process-graph", "graph.sqlite3");

/** `node:sqlite`'s path for a private database in memory, which has no directory to create. */
const inMemory = ":memory:";

/**
 * The command line's own data file: `process-graph/graph.sqlite3` under the XDG data directory (`XDG_DATA_HOME`, or `.local/share` in the home directory).
 * @param env - The environment.
 * @param home - The home directory.
 * @returns The path.
 */
const xdgDataPath = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string => {
  const xdg = env.XDG_DATA_HOME;

  return join(
    xdg !== undefined && xdg !== "" ? xdg : join(home, ".local", "share"),
    dataFile,
  );
};

/**
 * The data file used when `--data` is not given: `PROCESS_GRAPH_DATA` when it is set and not empty, otherwise `process-graph/graph.sqlite3` under the XDG data directory (`XDG_DATA_HOME`, or `.local/share` in the home directory).
 * @param env - The environment.
 * @param home - The home directory.
 * @returns The path.
 */
export const defaultDataPath = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string => {
  const named = env[dataVariable];

  return named !== undefined && named !== "" ? named : xdgDataPath(env, home);
};

/** A fact port that knows nothing: every condition is indeterminate and no input artefact is provided. */
const noFacts: Facts = () => ({ found: false });

/**
 * The version in a package manifest, which `--version` prints. Each bin passes its own manifest, so the entry point reports its own version rather than this package's.
 * @param manifest - The manifest's location, such as `new URL("../package.json", import.meta.url)` from a module in `dist/`.
 * @returns The version.
 * @throws Error when the manifest has no string `version`.
 */
export const packageVersion = (manifest: URL): string => {
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`${manifest.pathname} has no version`);
  }

  return parsed.version;
};

/**
 * The ports for a Node process: the SQLite store over `node:sqlite` (creating the data file's directory when needed, private when the command line or the host owns it), the GitHub issues source for `github:` scopes, the file system and the process's streams.
 * @param options - Replacements for any of the defaults.
 * @returns The ports.
 */
export const nodePorts = (options: NodePortsOptions = {}): CliPorts => {
  const env = options.env ?? process.env;
  const token = options.token ?? githubTokenFromEnvironment({ env });
  const home = options.home ?? homedir();
  // The data file the command line owns, the host's or else its own in the XDG data directory, whose directory it creates and keeps private; a path the user names is theirs.
  const ownDataPath = options.dataPath ?? xdgDataPath(env, home);

  return {
    stdout:
      options.stdout ??
      ((text) => {
        process.stdout.write(text);
      }),
    stderr:
      options.stderr ??
      ((text) => {
        process.stderr.write(text);
      }),
    defaultDataPath: options.dataPath ?? defaultDataPath(env, home),
    openStore: (path) => {
      const warnings =
        path === inMemory
          ? []
          : prepareDataFile(path, {
              ownsDirectory: path === ownDataPath,
              platform: options.platform ?? process.platform,
            });
      const { store, close } = openNodeGraphStore(path);

      return {
        client: createRouterClient(createGraphStoreRouter(store)),
        close,
        warnings,
      };
    },
    source: (prefix) =>
      prefix === githubSource
        ? createRouterClient(
            createGraphSourceRouter(
              createGitHubIssuesSource({
                token,
                now: options.now ?? Date.now,
                ...(options.fetch === undefined
                  ? {}
                  : { fetch: options.fetch }),
              }),
            ),
          )
        : undefined,
    readFile: async (path, signal) =>
      readFile(
        path,
        signal === undefined
          ? { encoding: "utf8" }
          : { encoding: "utf8", signal },
      ),
    facts: options.facts ?? noFacts,
    signal: options.signal,
  };
};

/**
 * Runs the command line as the current process: its arguments, its streams and the real ports, with an interrupt aborting whatever the command is waiting on. It resolves with the exit status rather than exiting, so the bin sets `process.exitCode` and pending output is flushed.
 * @param identity - The name and version the program presents.
 * @returns The exit status.
 */
export const runProcess = async (
  identity: ProgramIdentity,
): Promise<ExitCode> => {
  const controller = new AbortController();
  process.once("SIGINT", () => {
    controller.abort();
  });

  return runCli(
    process.argv.slice(2),
    nodePorts({ signal: controller.signal }),
    identity,
  );
};
