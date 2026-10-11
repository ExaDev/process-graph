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
import { emptyModel } from "@exadev/process-graph-store-contract";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  prepareDataFile,
  privateDirectoryMode,
  privateFileMode,
} from "./data-file.ts";
import { exitCodes } from "./exit-codes.ts";
import { nodePorts } from "./node.ts";
import { runCli } from "./program.ts";

/** A umask that leaves new files readable by group and others, the usual default, so a test fails if the code relies on the umask for privacy. */
const permissiveUmask = 0o022;
/** The modes such a umask gives a new directory and file. */
const looseDirectoryMode = 0o755;
const looseFileMode = 0o644;
/** The permission bits of a mode. */
const permissionBits = 0o777;

const modeOf = (path: string): number => statSync(path).mode & permissionBits;

let previousUmask: number;
let directory: string;

beforeEach(() => {
  previousUmask = process.umask(permissiveUmask);
  directory = mkdtempSync(join(tmpdir(), "process-graph-data-"));
});

afterEach(() => {
  process.umask(previousUmask);
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
  test("is created private, with the directories it creates, the database and the -wal and -shm files SQLite derives from it", async () => {
    const ports = portsIn();
    const path = ports.defaultDataPath;
    const opened = await ports.openStore(path);
    try {
      await opened.client.v1.models.save({
        modelId: "default",
        model: emptyModel,
      });

      expect(opened.warnings).toEqual([]);
      expect({
        xdg: modeOf(join(directory, "xdg")),
        app: modeOf(dirname(path)),
        database: modeOf(path),
        wal: modeOf(`${path}-wal`),
        shm: modeOf(`${path}-shm`),
      }).toEqual({
        xdg: privateDirectoryMode,
        app: privateDirectoryMode,
        database: privateFileMode,
        wal: privateFileMode,
        shm: privateFileMode,
      });
    } finally {
      await opened.close();
    }
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

test("on Windows, where file modes mean nothing, no mode is set or changed", () => {
  const path = join(directory, "xdg", "process-graph", "graph.sqlite3");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", { mode: looseFileMode });
  chmodSync(path, looseFileMode);

  expect(
    prepareDataFile(path, { ownsDirectory: true, platform: "win32" }),
  ).toEqual([]);
  expect(modeOf(path)).toBe(looseFileMode);
});
