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
