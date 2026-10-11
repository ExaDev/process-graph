import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { emptyModel } from "@exadev/process-graph-store-contract";
import { nodePorts } from "../src/node.ts";

/**
 * Run as its own process by `data-file.unit.test.ts`, because only a main thread may set the umask and Vitest (under Stryker especially) runs tests in worker threads. Arguments: the umask as an octal string, and a directory to use as the XDG data directory's parent. It sets the umask, opens the command line's own default store there, writes to it, and prints the permission bits of each directory and file it made, and the warnings the port returned, as one JSON object, while the store is still open so SQLite's `-wal` and `-shm` files exist.
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
const ports = nodePorts({
  env: { XDG_DATA_HOME: join(directory, "xdg") },
  home: directory,
});
const path = ports.defaultDataPath;
const opened = await ports.openStore(path);
try {
  await opened.client.v1.models.save({ modelId: "default", model: emptyModel });
  const modeOf = (file: string): number => statSync(file).mode & permissionBits;
  process.stdout.write(
    JSON.stringify({
      warnings: opened.warnings,
      xdg: modeOf(join(directory, "xdg")),
      app: modeOf(dirname(path)),
      database: modeOf(path),
      wal: modeOf(`${path}-wal`),
      shm: modeOf(`${path}-shm`),
    }),
  );
} finally {
  await opened.close();
}
