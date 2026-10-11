import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  discoverWorkspace,
  type WorkspacePackage,
} from "@exadev/semantic-release-workspace";
import { parse } from "yaml";

/**
 * The half of `deps:lint` that syncpack cannot express. A published manifest ships every specifier exactly as written, because `@semantic-release/npm` publishes with `npm publish`, so it must name exact versions, never a `workspace:`, `catalog:`, `link:` or `file:` protocol; each third-party version the catalog names must equal the catalog's, and each sibling version the sibling's own, so the published package was built and tested against what it declares. Every catalog entry must be an exact version too, since the catalog is where the private packages take theirs.
 */

/** One rule a manifest or the catalog breaks. */
export interface Finding {
  /** Where: a manifest path relative to the workspace root, or `pnpm-workspace.yaml` for the catalog. */
  readonly where: string;
  /** The dependency field, for a manifest finding. */
  readonly field?: string;
  /** The dependency. */
  readonly name: string;
  /** What is written. */
  readonly specifier: string;
  /** Why it is wrong. */
  readonly reason: string;
}

/** A protocol specifier that pnpm resolves inside the workspace and npm ships verbatim. */
const protocolSpecifier = /^(?:workspace|catalog|link|file):/;

/** An exact semantic version, prerelease and build metadata allowed, with no range operator. */
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Checks the catalog's entries.
 * @param catalog - The default catalog, library name to version.
 * @returns One finding per entry that is not an exact version.
 */
export const checkCatalog = (catalog: ReadonlyMap<string, string>): Finding[] =>
  [...catalog]
    .filter(([, version]) => !exactVersion.test(version))
    .map(([name, version]) => ({
      where: "pnpm-workspace.yaml",
      name,
      specifier: version,
      reason: "a catalog entry must be an exact version",
    }));

/**
 * Checks one published package's manifest against the catalog and its siblings.
 * @param pkg - The published package, as the release orchestrator discovers it.
 * @param catalog - The default catalog, library name to version.
 * @param siblings - Every workspace package's version, by name.
 * @returns One finding per dependency that breaks a rule; empty when the manifest is publishable as written.
 */
export const checkPublishedManifest = (
  pkg: Pick<WorkspacePackage, "relativeDirectory" | "dependencies">,
  catalog: ReadonlyMap<string, string>,
  siblings: ReadonlyMap<string, string>,
): Finding[] => {
  const where = `${pkg.relativeDirectory}/package.json`;

  return [...pkg.dependencies].flatMap(([field, entries]) =>
    [...entries].flatMap(([name, specifier]): Finding[] => {
      const finding = (reason: string): Finding[] => [
        { where, field, name, specifier, reason },
      ];
      if (protocolSpecifier.test(specifier)) {
        return finding(
          "npm publish ships a protocol specifier verbatim, which no consumer can install",
        );
      }
      if (!exactVersion.test(specifier)) {
        return finding("a published dependency must be an exact version");
      }
      const expected = siblings.get(name) ?? catalog.get(name);
      if (expected !== undefined && specifier !== expected) {
        return finding(
          `must equal ${siblings.has(name) ? "the sibling's own version" : "the catalog entry"}, ${expected}`,
        );
      }

      return [];
    }),
  );
};

/**
 * Reads the default catalog from a `pnpm-workspace.yaml` document.
 * @param text - The document.
 * @returns The catalog, library name to version; empty when the document has none.
 * @throws Error when the catalog is not a mapping of names to version strings.
 */
export const readCatalog = (text: string): Map<string, string> => {
  const document: unknown = parse(text);
  if (
    typeof document !== "object" ||
    document === null ||
    !("catalog" in document)
  ) {
    return new Map();
  }
  const { catalog } = document;
  if (typeof catalog !== "object" || catalog === null) {
    throw new Error("pnpm-workspace.yaml: catalog is not a mapping");
  }

  return new Map(
    Object.entries(catalog).map(([name, version]: [string, unknown]) => {
      if (typeof version !== "string") {
        throw new Error(
          `pnpm-workspace.yaml: catalog entry ${name} is not a version string`,
        );
      }

      return [name, version];
    }),
  );
};

/**
 * Checks every published manifest in the workspace and the catalog.
 * @param root - The workspace root.
 * @returns Every finding, in workspace order.
 */
export const checkWorkspace = async (root: string): Promise<Finding[]> => {
  const workspace = await discoverWorkspace(root);
  const catalog = readCatalog(
    readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
  );
  const siblings = new Map(
    workspace.packages.map((pkg) => [pkg.name, pkg.version]),
  );

  return [
    ...checkCatalog(catalog),
    ...workspace.packages
      .filter((pkg) => !pkg.private)
      .flatMap((pkg) => checkPublishedManifest(pkg, catalog, siblings)),
  ];
};

if (import.meta.main) {
  const findings = await checkWorkspace(process.cwd());
  for (const { where, field, name, specifier, reason } of findings) {
    const location = field === undefined ? where : `${where} ${field}`;
    process.stderr.write(`${location}: ${name} ${specifier}: ${reason}\n`);
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
}
