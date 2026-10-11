import { readFileSync } from "node:fs";

/** The manifest's version, read once when a build or test run is configured. */
const manifestVersion = (): string => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("package.json", import.meta.url), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("package.json has no version");
  }

  return manifest.version;
};

/**
 * The identifiers the bundler replaces at build time, each with the JavaScript expression it becomes, so the bundle carries the values rather than reading them at run time. `tsdown.config.ts` and `vitest.config.ts` both pass these as `define`, so source run under test sees what the bundle carries; `src/build-constants.d.ts` declares each one.
 */
export const buildConstants: Readonly<Record<string, string>> = {
  PROCESS_GRAPH_VERSION: JSON.stringify(manifestVersion()),
};
