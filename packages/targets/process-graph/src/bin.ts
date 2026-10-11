#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { exitCodes } from "@exadev/process-graph-cli/exit-codes";
import {
  commandLinePeers,
  missingPeers,
  missingPeersMessage,
} from "./missing-peers.ts";

/** This package's manifest, beside `dist/`. */
const manifest = new URL("../package.json", import.meta.url);

/** The peer dependency versions the manifest declares, by name. */
const declaredPeers = (): Map<string, string> => {
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("peerDependencies" in parsed) ||
    typeof parsed.peerDependencies !== "object" ||
    parsed.peerDependencies === null
  ) {
    throw new Error(`${manifest.pathname} declares no peerDependencies`);
  }

  return new Map(
    Object.entries(parsed.peerDependencies).flatMap(
      ([name, version]: [string, unknown]) =>
        typeof version === "string" ? [[name, version] as const] : [],
    ),
  );
};

/** Whether a package resolves from this bin's own location, as the command line's imports would. Only a package that is not installed counts as missing; any other resolution error is the import's to report. */
const resolves = (name: string): boolean => {
  try {
    import.meta.resolve(name);

    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND"
    ) {
      return false;
    }
    throw error;
  }
};

const missing = missingPeers(commandLinePeers, resolves);

if (missing.length > 0) {
  process.stderr.write(
    missingPeersMessage(
      missing,
      declaredPeers(),
      process.env.npm_config_user_agent,
    ),
  );
  process.exitCode = exitCodes.missingPeers;
} else {
  // Imported only once its peers are known to resolve, so a missing one is reported above rather than as an import failure.
  const { packageVersion, runProcess } =
    await import("@exadev/process-graph-cli");
  process.exitCode = await runProcess({
    name: "process-graph",
    version: packageVersion(manifest),
  });
}
