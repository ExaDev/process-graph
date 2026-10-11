import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** The throwaway project the packed package is installed into. */
    readonly consumer: string;
  }
}

/** The package's own directory. */
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

/**
 * Each peer dependency the manifest declares, as `name@version`, so the consumer installs every optional subpath's libraries at the versions the package was built against.
 * @returns The install specifiers.
 */
const peerSpecifiers = (): string[] => {
  const manifest: unknown = JSON.parse(
    readFileSync(join(packageDirectory, "package.json"), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("peerDependencies" in manifest) ||
    typeof manifest.peerDependencies !== "object" ||
    manifest.peerDependencies === null
  ) {
    throw new Error("package.json declares no peerDependencies");
  }

  return Object.entries(manifest.peerDependencies).map(
    ([name, version]: [string, unknown]) => `${name}@${String(version)}`,
  );
};

/**
 * Packs the built package with `pnpm pack`, as it would be published, and installs the tarball with npm into a new directory outside the repository, beside its peer dependencies, so the smoke tests import it exactly as a consumer would: through its exports map, with no workspace package reachable.
 * @param project - The smoke project, given the consumer's directory.
 * @returns Removes the consumer's directory.
 */
export default function setup(project: TestProject): () => void {
  const consumer = mkdtempSync(join(tmpdir(), "process-graph-consumer-"));
  execFileSync("pnpm", ["pack", "--pack-destination", consumer], {
    cwd: packageDirectory,
    stdio: "ignore",
  });
  const tarball = readdirSync(consumer).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) {
    throw new Error(`pnpm pack wrote no tarball to ${consumer}`);
  }
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      `./${tarball}`,
      ...peerSpecifiers(),
    ],
    { cwd: consumer, stdio: "ignore" },
  );
  project.provide("consumer", consumer);

  return () => {
    rmSync(consumer, { recursive: true, force: true });
  };
}
