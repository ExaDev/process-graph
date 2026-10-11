import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { exitCodes } from "./exit-codes.ts";
import { isUnsafeCharacter } from "@exadev/process-graph-export";
import {
  createHarness,
  runInOrder,
  type Harness,
} from "./test-support/harness.ts";

/** A title as a hostile source could write it: clear the screen (CSI 2J), set the clipboard (OSC 52, ended by BEL), reverse the rest of the line (a right-to-left override), and a NUL. */
const hostile =
  "Fix\u001b[2J\u001b]52;c;aGVsbG8=\u0007 \u202Egnp.exe\u0000 now";
/** The same title as the command line writes it. */
const escaped =
  "Fix\\u{1b}[2J\\u{1b}]52;c;aGVsbG8=\\u{7} \\u{202e}gnp.exe\\u{0} now";
/** Ordinary text from anywhere: accents, CJK and an emoji, none of which is changed. */
const ordinary = "Café 日本語 🚀";

/** The characters of an output that should never be written raw; empty for safe output. */
const unsafeIn = (output: string): string[] =>
  Array.from(output).filter((character) => isUnsafeCharacter(character));

/** One example of each kind of character the general-category rule escapes beyond the C0 and C1 controls, with the escape it is written as. */
const categoryExamples: readonly (readonly [string, string, string])[] = [
  ["the Arabic letter mark (Cf)", "\u061C", "\\u{61c}"],
  ["the left-to-right mark (Cf)", "\u200E", "\\u{200e}"],
  ["the right-to-left mark (Cf)", "\u200F", "\\u{200f}"],
  ["the line separator (Zl)", "\u2028", "\\u{2028}"],
  ["the paragraph separator (Zp)", "\u2029", "\\u{2029}"],
  ["the soft hyphen (Cf)", "\u00AD", "\\u{ad}"],
  ["a tag character (Cf)", "\u{E0041}", "\\u{e0041}"],
  ["the interlinear annotation anchor (Cf)", "\uFFF9", "\\u{fff9}"],
  ["a private-use character (Co)", "\uE000", "\\u{e000}"],
  ["an unassigned code point (Cn)", "\u2065", "\\u{2065}"],
];

describe("every human-readable and diagram output of the command line", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await runInOrder(harness, [
      ["add", "participant", `team${hostile}`, hostile],
      ["add", "participant", "shop", ordinary, "--kind", "system"],
      ["add", "participant", "order", "Order", "--kind", "entity"],
      ["add", "activity", "prepare", ordinary, "--actor", "shop"],
      [
        "add",
        "activity",
        `submit${hostile}`,
        hostile,
        "--actor",
        `team${hostile}`,
      ],
      ["add", "decision", "stock", ordinary, "--actor", "shop"],
      ["add", "activity", "pack", ordinary, "--actor", "shop"],
      ["add", "transition", "prepare", `submit${hostile}`, "--id", "t0"],
      ["add", "transition", `submit${hostile}`, "stock", "--id", "t1"],
      ["add", "transition", "stock", "pack", "--id", "t2", "--guard", hostile],
    ]);
  });

  afterEach(() => {
    harness.remove();
  });

  test.each([
    [["ready"]],
    [["blocked", "pack"]],
    [["impact", "prepare"]],
    [["why", "pack"]],
    [["handoffs"]],
    [["path"]],
  ])("%j writes the hostile text escaped", async (args) => {
    // With the first step done, the hostile-titled step is the ready one and the end of every blocked-by chain.
    await harness.run("set", "prepare", "done");
    const result = await harness.run(...args);

    expect(result.code).toBe(exitCodes.success);
    expect(unsafeIn(result.stdout)).toEqual([]);
    expect(result.stdout).toMatch(/\\u\{1b\}\[2J|\\u\{1b\}/u);
  });

  test("ready, why and path keep ordinary text unchanged", async () => {
    expect((await harness.run("ready")).stdout).toBe(`prepare\t${ordinary}\n`);
    expect((await harness.run("path")).stdout).toContain(`pack\t${ordinary}`);
  });

  /** The arguments each view needs: the state view follows an entity, the sequence view a scenario. */
  const viewArgs: Readonly<Record<string, readonly string[]>> = {
    flowchart: [],
    swimlane: [],
    state: ["--subject", "order"],
    sequence: ["--scenario", "t1", "t2"],
  };

  test.each(
    Object.keys(viewArgs).flatMap((view) =>
      ["mermaid", "dot"].map((format) => ({ view, format })),
    ),
  )(
    "show --view $view --format $format writes the hostile text escaped inside well-formed labels, and ordinary text unchanged",
    async ({ view, format }) => {
      const { code, stdout } = await harness.run(
        "show",
        "--view",
        view,
        "--format",
        format,
        ...(viewArgs[view] ?? []),
      );

      expect(code).toBe(exitCodes.success);
      expect(unsafeIn(stdout)).toEqual([]);
      // DOT doubles the escape's backslash inside its quoted string; Mermaid leaves it, since a backslash is not Mermaid syntax.
      expect(stdout).toContain(
        format === "dot" ? escaped.replaceAll("\\", "\\\\") : "\\u{1b}[2J",
      );
      expect(stdout).toContain(view === "state" ? "\\u{202e}" : ordinary);
    },
  );

  test.each(Object.keys(viewArgs))(
    "show --view %s --format json writes the hostile text as JSON escapes, parsing back to the source's text, the same as --json writes it",
    async (view) => {
      const args = [
        "show",
        "--view",
        view,
        "--format",
        "json",
        ...(viewArgs[view] ?? []),
      ];
      const text = await harness.run(...args);
      const json = await harness.run(...args, "--json");

      expect(text.code).toBe(exitCodes.success);
      expect(unsafeIn(text.stdout)).toEqual([]);
      expect(text.stdout).not.toContain("\\u{");
      expect(text.stdout).toBe(json.stdout);
      // Parsed, the escapes are the source's own characters again: the right-to-left override every view carries comes back raw.
      expect(JSON.stringify(JSON.parse(text.stdout))).toContain("\u202E");
    },
  );

  test("--json writes nothing unsafe raw and carries the text unchanged once parsed", async () => {
    await harness.run("set", "prepare", "done");
    const { stdout } = await harness.run("ready", "--json");

    expect(unsafeIn(stdout)).toEqual([]);
    expect(JSON.parse(stdout)).toMatchObject({
      elements: [{ id: `submit${hostile}`, label: hostile }],
    });
  });

  test("an error that echoes the text writes it escaped on standard error", async () => {
    const result = await harness.run("why", `missing${hostile}`);

    expect(result.code).toBe(exitCodes.notFound);
    expect(unsafeIn(result.stderr)).toEqual([]);
    expect(result.stderr).toContain(`missing${escaped}`);
  });

  test.each([["cycles"], ["validate"]])(
    "%s writes the hostile identifiers of an illegal cycle escaped",
    async (command) => {
      await runInOrder(harness, [
        ["add", "activity", `loop${hostile}`, "Loop", "--model", "loop"],
        ["add", "activity", "back", "Back", "--model", "loop"],
        ["add", "transition", `loop${hostile}`, "back", "--model", "loop"],
        ["add", "transition", "back", `loop${hostile}`, "--model", "loop"],
      ]);
      const result = await harness.run(command, "--model", "loop");

      expect(result.code).toBe(exitCodes.invalidModel);
      expect(unsafeIn(result.stdout)).toEqual([]);
      expect(result.stdout).toContain(`loop${escaped}`);
    },
  );

  test("every category example comes out escaped in human output and unchanged once --json is parsed", async () => {
    const label = categoryExamples.map(([, character]) => character).join("|");
    await runInOrder(harness, [
      ["add", "activity", "marks", label, "--model", "marks"],
    ]);
    const text = await harness.run("ready", "--model", "marks");
    const json = await harness.run("ready", "--model", "marks", "--json");

    expect(unsafeIn(text.stdout)).toEqual([]);
    expect(text.stdout).toBe(
      `marks\t${categoryExamples.map(([, , escape]) => escape).join("|")}\n`,
    );
    expect(unsafeIn(json.stdout)).toEqual([]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      elements: [{ id: "marks", label }],
    });
  });
});
