import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { emptyModel } from "@exadev/process-graph-store-contract";
import { prepareDataFile } from "../src/data-file.ts";
import { openNodeGraphStore } from "../src/open.ts";

/**
 * Run as its own process by `data-file.unit.test.ts`, because only a main thread may set the umask and Vitest (under Stryker especially) runs tests in worker threads. Arguments: the umask as an octal string, and a directory to hold the store. It sets the umask, prepares a data file two missing directories deep in a directory it owns, opens the store there, writes to it, and prints the permission bits of each directory and file it made, and the warnings `prepareDataFile` returned, as one JSON object, while the store is still open so SQLite's `-wal` and `-shm` files exist.
 */

const [umask, directory] = process.argv.slice(2);
if (umask === undefined || directory === undefined) {
  throw new Error("usage: umask-probe.ts <octal umask> <directory>");
}

/** The radix of the umask argument. */
const octal = 8;
/** The permission bits of a mode. */
const permissionBits = 0o777;

process.umask(Number.parseInt(umask, octal));
const path = join(directory, "home", "graph", "graph.sqlite3");
const warnings = prepareDataFile(path, {
  ownsDirectory: true,
  platform: process.platform,
});
const { store, close } = openNodeGraphStore(path);
try {
  await store.saveModel({
    modelId: "default",
    model: emptyModel,
    signal: undefined,
  });
  const modeOf = (file: string): number => statSync(file).mode & permissionBits;
  process.stdout.write(
    JSON.stringify({
      warnings,
      home: modeOf(join(directory, "home")),
      graph: modeOf(dirname(path)),
      database: modeOf(path),
      wal: modeOf(`${path}-wal`),
      shm: modeOf(`${path}-shm`),
    }),
  );
} finally {
  close();
}
