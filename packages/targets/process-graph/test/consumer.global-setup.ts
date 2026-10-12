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
    /** The throwaway project the packed package is installed into, beside every peer dependency. */
    readonly consumer: string;
    /** A throwaway project the packed package is installed into alone, without its optional peers. */
    readonly bareConsumer: string;
  }
}

/** The package's own directory. */
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

/**
 * Each peer dependency the manifest declares, as `name@version` at the lowest version its specifier admits, so the consumer installs every optional subpath's libraries at the floor the manifest claims was tested. A stable peer is a caret range on one version and a prerelease peer is that version exactly (`scripts/check-published-manifests.ts` holds both), so dropping a leading caret gives the floor.
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
    ([name, version]: [string, unknown]) =>
      `${name}@${String(version).replace(/^\^/, "")}`,
  );
};

/**
 * Makes a throwaway project outside the repository and installs a tarball into it with pnpm.
 * @param tarball - The packed package.
 * @param specifiers - Further packages to install beside it.
 * @returns The project's directory.
 */
const consumerOf = (tarball: string, specifiers: readonly string[]): string => {
  const consumer = mkdtempSync(join(tmpdir(), "process-graph-consumer-"));
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  // pnpm rather than npm: npm 11.19.0, the npm the pinned Node ships, cannot resolve the `effect` peer range of drizzle-orm's 1.0.0 release candidates at all (ERESOLVE, with or without this package), which npm 11.19.1 fixes.
  execFileSync("pnpm", ["add", "--ignore-scripts", tarball, ...specifiers], {
    cwd: consumer,
    // Output is captured rather than shown, and a failure's error carries pnpm's own report of why.
    encoding: "utf8",
  });

  return consumer;
};

/**
 * Packs the built package with `pnpm pack`, as it would be published, and installs the tarball with pnpm into two new projects outside the repository, one beside every peer dependency and one alone, so the smoke tests use it exactly as a consumer would: through its exports map, with no workspace package reachable.
 * @param project - The smoke project, given both consumers' directories.
 * @returns Removes the tarball and both consumers.
 */
export default function setup(project: TestProject): () => void {
  const packed = mkdtempSync(join(tmpdir(), "process-graph-packed-"));
  execFileSync("pnpm", ["pack", "--pack-destination", packed], {
    cwd: packageDirectory,
    encoding: "utf8",
  });
  const tarball = readdirSync(packed).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) {
    throw new Error(`pnpm pack wrote no tarball to ${packed}`);
  }
  const consumer = consumerOf(join(packed, tarball), peerSpecifiers());
  const bareConsumer = consumerOf(join(packed, tarball), []);
  project.provide("consumer", consumer);
  project.provide("bareConsumer", bareConsumer);

  return () => {
    for (const directory of [packed, consumer, bareConsumer]) {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}
