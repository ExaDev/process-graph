import { commitTypes } from "./commit-types.ts";

/**
 * Plain, whole-repo semantic-release: one shared version and one shared CHANGELOG.md for the entire repository, not independent per-package releases. `@exadev/semantic-release-workspace` (independent per-package releases) is the documented upgrade path in CONTRIBUTING.md once the packages are ready to be published on their own schedules.
 *
 * npmPublish is false throughout: publishing to the npm registry needs each package's trusted publisher registered first, which is a registry setting made by a person, so releasing here only versions, tags and writes the changelog until that is done. See CONTRIBUTING.md.
 */
/**
 * commit-analyzer only falls back to its default rules, which include "a breaking change is a major release", when no custom rule matches a commit. A breaking `feat` matches `feat -> minor` here, so without this rule it would release as a minor version.
 */
const releaseRules = [
  { breaking: true, release: "major" },
  ...commitTypes
    .filter((entry) => entry.release !== false)
    .map((entry) => ({ type: entry.type, release: entry.release })),
];

const presetChangelogTitles = Object.fromEntries(
  commitTypes.map((entry) => [entry.type, { title: entry.section }]),
);

export default {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules,
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: Object.entries(presetChangelogTitles).map(([type, value]) => ({
            type,
            ...value,
          })),
        },
      },
    ],
    "@semantic-release/changelog",
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json"],
        message: "chore(release): ${nextRelease.version}",
      },
    ],
    "@semantic-release/github",
  ],
};
