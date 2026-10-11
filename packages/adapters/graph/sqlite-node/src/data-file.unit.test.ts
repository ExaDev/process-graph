import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  prepareDataFile,
  privateDirectoryMode,
  privateFileMode,
} from "./data-file.ts";
import { openNodeGraphStore } from "./open.ts";

/** The modes the usual umask gives a new directory and file, readable by group and others. */
const looseDirectoryMode = 0o755;
const looseFileMode = 0o644;
/** The permission bits of a mode. */
const permissionBits = 0o777;
/** A umask that leaves new files readable by group and others, the usual default, so a test fails if the code relies on the umask for privacy. */
const permissiveUmask = 0o022;
/** A umask that removes nothing, so every mode the code asks for is the mode it gets. */
const openUmask = 0o000;
/** The radix the probe reads its umask argument in. */
const octal = 8;

/** The probe that prepares and opens a store under a given umask, in a process of its own, since only a main thread may set the umask and Vitest runs tests in worker threads. */
const probe = fileURLToPath(new URL("../test/umask-probe.ts", import.meta.url));

const modeOf = (path: string): number => statSync(path).mode & permissionBits;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "process-graph-data-file-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Makes a directory and a file in it with modes others can read, as an earlier, careless run might have. */
const looseStore = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  chmodSync(dirname(path), looseDirectoryMode);
  writeFileSync(path, "");
  chmodSync(path, looseFileMode);
};

/** No per-test time limit for the probe: it starts a Node process, so how long it takes is the machine's scheduling, not a property of this code, and a clock bound only fails it under load. The CI job's own timeout still ends a hang. */
const unbounded = 0;

describe(
  "a store prepared in a process with its own umask",
  { timeout: unbounded },
  () => {
    test.each([
      { name: "the usual 022", umask: permissiveUmask },
      { name: "000, which narrows nothing", umask: openUmask },
    ])(
      "under a umask of $name, creates the missing directories, the database and the -wal and -shm files SQLite derives from it private",
      ({ umask }) => {
        const result = spawnSync(
          process.execPath,
          [probe, umask.toString(octal), directory],
          { encoding: "utf8" },
        );
        if (result.status !== 0) {
          throw new Error(result.stderr);
        }
        const modes: unknown = JSON.parse(result.stdout);

        expect(modes).toEqual({
          warnings: [],
          home: privateDirectoryMode,
          graph: privateDirectoryMode,
          database: privateFileMode,
          wal: privateFileMode,
          shm: privateFileMode,
        });
      },
    );
  },
);

describe("in a directory the caller owns", () => {
  test("creates the missing directories and the database private, and the store SQLite opens there keeps its sidecars private", () => {
    const path = join(directory, "home", "graph", "graph.sqlite3");

    expect(
      prepareDataFile(path, { ownsDirectory: true, platform: "linux" }),
    ).toEqual([]);
    const { store, close } = openNodeGraphStore(path);
    close();

    expect(store).toBeDefined();
    expect([
      modeOf(join(directory, "home")),
      modeOf(dirname(path)),
      modeOf(path),
    ]).toEqual([privateDirectoryMode, privateDirectoryMode, privateFileMode]);
  });

  test("narrows an existing directory and store files others can read, and names them in one warning", () => {
    const path = join(directory, "graph", "graph.sqlite3");
    looseStore(path);
    writeFileSync(`${path}-wal`, "");
    chmodSync(`${path}-wal`, looseFileMode);

    expect(
      prepareDataFile(path, { ownsDirectory: true, platform: "linux" }),
    ).toEqual([
      `made ${dirname(path)}, ${path}, ${path}-wal readable by its owner only, since other users could read the synced work in it`,
    ]);
    expect([
      modeOf(dirname(path)),
      modeOf(path),
      modeOf(`${path}-wal`),
    ]).toEqual([privateDirectoryMode, privateFileMode, privateFileMode]);
  });

  test("says nothing when the store is already private", () => {
    const path = join(directory, "graph", "graph.sqlite3");
    prepareDataFile(path, { ownsDirectory: true, platform: "linux" });

    expect(
      prepareDataFile(path, { ownsDirectory: true, platform: "linux" }),
    ).toEqual([]);
  });
});

describe("in a directory someone else chose", () => {
  test("creates the database private but leaves the directory's mode as it is", () => {
    const supplied = join(directory, "theirs");
    mkdirSync(supplied);
    chmodSync(supplied, looseDirectoryMode);
    const path = join(supplied, "graph.sqlite3");

    expect(
      prepareDataFile(path, { ownsDirectory: false, platform: "linux" }),
    ).toEqual([]);
    expect([modeOf(supplied), modeOf(path)]).toEqual([
      looseDirectoryMode,
      privateFileMode,
    ]);
  });

  test("leaves a database file that already exists as it is", () => {
    const path = join(directory, "theirs", "graph.sqlite3");
    looseStore(path);

    expect(
      prepareDataFile(path, { ownsDirectory: false, platform: "linux" }),
    ).toEqual([]);
    expect(modeOf(path)).toBe(looseFileMode);
  });
});

test("on Windows, where file modes mean nothing, creates the directory and sets or changes no mode", () => {
  const path = join(directory, "xdg", "process-graph", "graph.sqlite3");
  looseStore(path);

  expect(
    prepareDataFile(path, { ownsDirectory: true, platform: "win32" }),
  ).toEqual([]);
  expect(modeOf(path)).toBe(looseFileMode);

  const fresh = join(directory, "fresh", "graph.sqlite3");
  prepareDataFile(fresh, { ownsDirectory: true, platform: "win32" });

  expect(statSync(dirname(fresh)).isDirectory()).toBe(true);
});
