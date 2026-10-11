import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  privateDirectoryMode,
  privateFileMode,
} from "@exadev/process-graph-sqlite-node";
import { exitCodes } from "./exit-codes.ts";
import { nodePorts } from "./node.ts";
import { runCli } from "./program.ts";

/** The modes the usual umask gives a new directory and file, readable by group and others. */
const looseDirectoryMode = 0o755;
const looseFileMode = 0o644;
/** The permission bits of a mode. */
const permissionBits = 0o777;

const modeOf = (path: string): number => statSync(path).mode & permissionBits;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "process-graph-data-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** The Node ports with the XDG data directory inside the test's directory, so the default store is the command line's own. */
const portsIn = (stderr: (text: string) => void = () => undefined) =>
  nodePorts({
    env: { XDG_DATA_HOME: join(directory, "xdg") },
    home: directory,
    stderr,
  });

describe("the command line's own default store", () => {
  // Whatever the umask, `prepareDataFile` makes these modes; its own tests in sqlite-node set the umask in a probe process. This checks the command line hands it its XDG data file as one it owns.
  test("is created private, with the XDG data directory above it", async () => {
    const ports = portsIn();
    const path = ports.defaultDataPath;
    const opened = await ports.openStore(path);
    await opened.close();

    expect(path).toBe(join(directory, "xdg", "process-graph", "graph.sqlite3"));
    expect(opened.warnings).toEqual([]);
    expect([
      modeOf(join(directory, "xdg")),
      modeOf(dirname(path)),
      modeOf(path),
    ]).toEqual([privateDirectoryMode, privateDirectoryMode, privateFileMode]);
  });

  test("is narrowed when it already exists readable by others, and the command line says so on standard error", async () => {
    let stderr = "";
    const ports = portsIn((text) => {
      stderr += text;
    });
    const path = ports.defaultDataPath;
    mkdirSync(dirname(path), { recursive: true, mode: looseDirectoryMode });
    writeFileSync(path, "", { mode: looseFileMode });
    chmodSync(dirname(path), looseDirectoryMode);
    chmodSync(path, looseFileMode);

    await expect(
      runCli(["add", "participant", "team", "Team"], ports, {
        name: "process-graph",
        version: "0.0.0",
      }),
    ).resolves.toBe(exitCodes.success);

    expect([modeOf(dirname(path)), modeOf(path)]).toEqual([
      privateDirectoryMode,
      privateFileMode,
    ]);
    expect(stderr).toBe(
      `warning: made ${dirname(path)}, ${path} readable by its owner only, since other users could read the synced work in it\n`,
    );
  });
});

describe("a store at a path the user names", () => {
  test("creates its database private but never changes the directory the user supplied", async () => {
    const supplied = join(directory, "mine");
    mkdirSync(supplied, { mode: looseDirectoryMode });
    chmodSync(supplied, looseDirectoryMode);
    const path = join(supplied, "graph.sqlite3");
    const opened = await portsIn().openStore(path);
    await opened.close();

    expect(opened.warnings).toEqual([]);
    expect([modeOf(supplied), modeOf(path)]).toEqual([
      looseDirectoryMode,
      privateFileMode,
    ]);
  });

  test("leaves a database file that already exists as it is", async () => {
    const path = join(directory, "existing.sqlite3");
    writeFileSync(path, "", { mode: looseFileMode });
    chmodSync(path, looseFileMode);
    const opened = await portsIn().openStore(path);
    await opened.close();

    expect(opened.warnings).toEqual([]);
    expect(modeOf(path)).toBe(looseFileMode);
  });
});

describe("a data file the host owns", () => {
  test("is the default data path, over PROCESS_GRAPH_DATA, and is created private with the directories above it", async () => {
    const owned = join(directory, "host", "graph", "graph.sqlite3");
    let stderr = "";
    const ports = nodePorts({
      env: { PROCESS_GRAPH_DATA: join(directory, "elsewhere.sqlite3") },
      home: directory,
      dataPath: owned,
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(ports.defaultDataPath).toBe(owned);
    await expect(
      runCli(["add", "participant", "team", "Team"], ports, {
        name: "sb graph",
        version: "0.0.0",
      }),
    ).resolves.toBe(exitCodes.success);
    expect([
      modeOf(join(directory, "host")),
      modeOf(dirname(owned)),
      modeOf(owned),
    ]).toEqual([privateDirectoryMode, privateDirectoryMode, privateFileMode]);
    expect(stderr).toBe("");
  });

  test("is narrowed when it already exists readable by others, as the command line's own is", async () => {
    const owned = join(directory, "host", "graph.sqlite3");
    mkdirSync(dirname(owned), { mode: looseDirectoryMode });
    chmodSync(dirname(owned), looseDirectoryMode);
    writeFileSync(owned, "");
    chmodSync(owned, looseFileMode);
    const opened = await nodePorts({
      home: directory,
      dataPath: owned,
    }).openStore(owned);
    await opened.close();

    expect(opened.warnings).toEqual([
      `made ${dirname(owned)}, ${owned} readable by its owner only, since other users could read the synced work in it`,
    ]);
    expect([modeOf(dirname(owned)), modeOf(owned)]).toEqual([
      privateDirectoryMode,
      privateFileMode,
    ]);
  });
});
