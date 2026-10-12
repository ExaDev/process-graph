import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  discoverWorkspace,
  type WorkspacePackage,
} from "@exadev/semantic-release-workspace";
import { prerelease, satisfies } from "semver";
import { parse } from "yaml";

/**
 * The half of `deps:lint` that syncpack cannot express. A published manifest ships every specifier exactly as written, because `@semantic-release/npm` publishes with `npm publish`, so it must never name a `workspace:`, `catalog:`, `link:` or `file:` protocol. Every catalog entry must be an exact version, since the catalog is where the private packages take theirs.
 *
 * `dependencies` and `devDependencies` name exact versions, each third-party one equal to the catalog's and each sibling one equal to the sibling's own, so the published package was built and tested against what it installs.
 *
 * `peerDependencies` are the consumer's own installs, so pinning one to a single version would force every consumer onto exactly that version. A peer with a stable version is declared as a caret range on one version, `^<version>`, whose floor is the lowest version tested: the catalog's version, which every test in the workspace runs against, must satisfy it, and the smoke test installs the packed package beside each peer at its floor. A peer whose version is a prerelease (`2.0.0-beta.42`, `1.0.0-rc.5-5935859`) stays exact and equal to the catalog's, because a prerelease has no compatible-range semantics: a caret range on one matches only later prereleases of that same version, which may break anything, and no stable release.
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

/** A caret range on one exact version, the only range a published peer may declare. */
const caretRange = new RegExp(`^\\^${exactVersion.source.slice(1)}`);

/** The dependency field whose ranges the consumer resolves against its own installs. */
const peerField = "peerDependencies";

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
 * Checks one peer dependency's specifier.
 * @param specifier - What the manifest declares.
 * @param expected - The catalog's or the sibling's version, which the workspace's tests run against; `undefined` when neither names the peer.
 * @param source - Which of the two `expected` is, for the message.
 * @returns The reasons the specifier is wrong; empty when it is right.
 */
const checkPeer = (
  specifier: string,
  expected: string | undefined,
  source: string,
): string[] => {
  const tested = expected ?? specifier.replace(/^\^/, "");
  if (prerelease(tested) !== null) {
    if (!exactVersion.test(specifier)) {
      return [
        "a prerelease peer must be an exact version, since a prerelease has no compatible-range semantics",
      ];
    }

    return expected !== undefined && specifier !== expected
      ? [`must equal ${source}, ${expected}`]
      : [];
  }
  if (!caretRange.test(specifier)) {
    return [
      "a stable peer must be a caret range on the lowest tested version, such as ^1.2.3",
    ];
  }

  return expected !== undefined && !satisfies(expected, specifier)
    ? [
        `must be satisfied by ${source}, ${expected}, which the tests run against`,
      ]
    : [];
};

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
      const expected = siblings.get(name) ?? catalog.get(name);
      const source = siblings.has(name)
        ? "the sibling's own version"
        : "the catalog entry";
      if (field === peerField) {
        return checkPeer(specifier, expected, source).flatMap(finding);
      }
      if (!exactVersion.test(specifier)) {
        return finding("a published dependency must be an exact version");
      }
      if (expected !== undefined && specifier !== expected) {
        return finding(`must equal ${source}, ${expected}`);
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
