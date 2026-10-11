import {
  discoverWorkspace,
  type PublishPluginSpec,
  type ReleaseWorkspaceOptions,
} from "@exadev/semantic-release-workspace";
import { commitTypes } from "./commit-types.ts";

/**
 * Independent per-package releases through `@exadev/semantic-release-workspace`, invoked as `pnpm release`. Every package gets its own version and `<name>@<version>` tag, decided from the commits that touched its own directory, and a package is released after every sibling it depends on. `process-graph`, the one published package, also gets a CHANGELOG.md and a GitHub Release; the private packages it bundles get neither (see `privatePlugins`).
 *
 * The commit types and which of them release come from `commit-types.ts`, the same list `commitlint.config.ts` validates against, so a type cannot trigger a release without also passing commit-message validation, or the reverse.
 *
 * The orchestrator sets the tag format, plugins and analysis options on every per-package run itself, so a `release.config.*` inside a package would be overridden by construction: release configuration lives only in this file.
 *
 * `commitStrategy: "single"` folds every version bump, changelog and dependency-range rewrite of one run into one commit and pushes it with the tags atomically before anything publishes, so a rejected push leaves nothing half-released. It is why `@semantic-release/git` is absent from the plugin list: the orchestrator makes that commit itself and rejects the plugin in this mode.
 */

/**
 * Every commit type releases, at the level `commit-types.ts` names, and appears in the notes under its own section. commit-analyzer only falls back to its default rules, which include "a breaking change is a major release", when no custom rule matches a commit. A breaking `feat` matches `feat -> minor` here, so without this rule it would release as a minor version.
 */
const releaseRules = [
  { breaking: true, release: "major" },
  ...commitTypes.map((entry) => ({
    type: entry.type,
    release: entry.release,
  })),
];

/**
 * Every commit type gets its section name and is shown. The conventionalcommits preset hides docs, style, refactor, test, build, ci and chore by default, so `hidden: false` is stated for each type rather than left to that default: a release must never publish empty notes.
 */
const noteTypes = commitTypes.map((entry) => ({
  type: entry.type,
  section: entry.section,
  hidden: false,
}));

const plugins: readonly PublishPluginSpec[] = [
  "@semantic-release/changelog",
  ["@semantic-release/npm", { npmPublish: true }],
  "@semantic-release/github",
];

/**
 * A private package is bundled into `process-graph` and never published, so it keeps only the step that bumps its version: `@semantic-release/npm`, which skips publishing for a manifest marked `private`. It writes no CHANGELOG.md and creates no GitHub Release, since neither describes anything a consumer installs; the orchestrator would drop the Release on its own, but an explicit list is taken exactly as written. It still takes a version and a `<name>@<version>` tag, which the orchestrator needs to find its last release, and its release still cascades: `process-graph` lists it in `devDependencies`, which the orchestrator follows like any other dependency field, so a change to a bundled package releases `process-graph`.
 */
const privatePlugins: readonly PublishPluginSpec[] = [
  ["@semantic-release/npm", { npmPublish: true }],
];

const workspace = await discoverWorkspace(import.meta.dirname);

const config: Pick<
  ReleaseWorkspaceOptions,
  | "branches"
  | "commitStrategy"
  | "plugins"
  | "packagePlugins"
  | "analyzeCommits"
  | "generateNotes"
> = {
  branches: ["main"],
  commitStrategy: "single",
  plugins,
  packagePlugins: Object.fromEntries(
    workspace.packages
      .filter((pkg) => pkg.private)
      .map((pkg) => [pkg.name, privatePlugins]),
  ),
  analyzeCommits: {
    preset: "conventionalcommits",
    releaseRules,
  },
  generateNotes: {
    preset: "conventionalcommits",
    presetConfig: { types: noteTypes },
  },
};

export default config;
