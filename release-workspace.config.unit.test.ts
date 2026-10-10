import { describe, expect, it } from "vitest";

import { commitTypes } from "./commit-types.ts";
import config from "./release-workspace.config.ts";

/**
 * release-workspace.config.ts derives its release rules and its release-notes sections from `commit-types.ts`, and commitlint.config.ts validates against the same list. These tests make the agreement mechanical.
 *
 * `analyzeCommits` and `generateNotes` are typed as `Record<string, unknown>` in `@exadev/semantic-release-workspace`, because they pass straight through to plugins whose option shapes it does not model, so the runtime narrowing below is load-bearing: TypeScript cannot enforce the agreement.
 */

interface TypedEntry {
  readonly type: string;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An entry keyed by commit type. The `{ breaking: true }` release rule has no type and is deliberately not matched: "breaking" is a commit footer, never a type written in a subject line. */
function isTypedEntry(value: unknown): value is TypedEntry {
  return isRecord(value) && typeof value.type === "string";
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(
      `release-workspace.config.ts must define ${path} as an object`,
    );
  }

  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `release-workspace.config.ts must define ${path} as an array`,
    );
  }

  return value;
}

const analyzeCommits = requireRecord(config.analyzeCommits, "analyzeCommits");
const generateNotes = requireRecord(config.generateNotes, "generateNotes");
const presetConfig = requireRecord(
  generateNotes.presetConfig,
  "generateNotes.presetConfig",
);

const allReleaseRules = requireArray(
  analyzeCommits.releaseRules,
  "analyzeCommits.releaseRules",
);
const releaseRules = allReleaseRules.filter(isTypedEntry);
const noteEntries = requireArray(
  presetConfig.types,
  "generateNotes.presetConfig.types",
).filter(isTypedEntry);

const releasingTypes = commitTypes
  .filter((entry) => entry.release !== false)
  .map((entry) => entry.type);

describe("release-workspace.config.ts", () => {
  it("analyses and renders commits under the same preset", () => {
    // A writer is only guaranteed to render the commit shapes its own preset's parser produces.
    expect(generateNotes.preset).toBe(analyzeCommits.preset);
  });

  it("releases exactly the commit types commit-types.ts marks as releasing", () => {
    expect(releaseRules.map((rule) => rule.type).sort()).toStrictEqual(
      [...releasingTypes].sort(),
    );
  });

  it("releases each type at the level commit-types.ts names", () => {
    for (const { type, release } of commitTypes) {
      if (release === false) {
        continue;
      }
      expect(releaseRules.find((rule) => rule.type === type)?.release).toBe(
        release,
      );
    }
  });

  it("makes a breaking change a major release", () => {
    expect(allReleaseRules).toContainEqual({
      breaking: true,
      release: "major",
    });
  });

  it("names a non-empty section for every commit type", () => {
    expect(noteEntries.map((entry) => entry.type).sort()).toStrictEqual(
      commitTypes.map((entry) => entry.type).sort(),
    );
    for (const { type, section } of commitTypes) {
      const noteEntry = noteEntries.find((entry) => entry.type === type);
      expect(noteEntry?.section, `type "${type}" needs a section name`).toBe(
        section,
      );
      expect(section, `type "${type}" needs a section name`).not.toBe("");
    }
  });

  it("hides no type that earns a release from the notes", () => {
    // The preset hides docs, style, chore, refactor, test, build and ci by default; a type that releases must never inherit that, or its release would publish empty notes.
    for (const type of releasingTypes) {
      expect(
        noteEntries.find((entry) => entry.type === type)?.hidden,
        `type "${type}"`,
      ).toBe(false);
    }
  });
});
