import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { exitCodes } from "./exit-codes.ts";
import {
  isUnsafeCharacter,
  terminalJson,
  terminalText,
} from "./terminal-text.ts";
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

/** Text that must pass through unchanged: a family emoji joined by zero-width joiners, CJK, accents, Arabic, and Persian with its zero-width non-joiner. */
const scripts = [
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
  "日本語の文",
  "crème brûlée",
  "مرحبا بالعالم",
  "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645",
];

describe("terminalText", () => {
  test("escapes every control and format character class it guards, visibly and by code point", () => {
    expect(
      terminalText(
        "\u0000\u0008\u000B\u001F\u007F\u0080\u009F\u200B\u200F\u202A\u202E\u2060\u2064\u2066\u2069\uFEFF",
      ),
    ).toBe(
      "\\u{0}\\u{8}\\u{b}\\u{1f}\\u{7f}\\u{80}\\u{9f}\\u{200b}\\u{200f}\\u{202a}\\u{202e}\\u{2060}\\u{2064}\\u{2066}\\u{2069}\\u{feff}",
    );
  });

  test("leaves line feed, tab and ordinary text in any script exactly as written, joiners included", () => {
    const text = `a\tb\n${ordinary}${scripts.join(" ")}`;

    expect(terminalText(text)).toBe(text);
  });

  test.each(categoryExamples)(
    "escapes %s visibly by its code point",
    (_name, character, escape) => {
      expect(terminalText(`a${character}b`)).toBe(`a${escape}b`);
    },
  );

  test("escapes a hostile title", () => {
    expect(terminalText(hostile)).toBe(escaped);
  });
});

describe("terminalJson", () => {
  test.each(categoryExamples)(
    "writes %s as a JSON escape that parses back to it",
    (_name, character) => {
      const json = terminalJson({ title: `a${character}b` });

      expect(unsafeIn(json)).toEqual([]);
      expect(json).toMatch(/\\u[0-9a-f]{4}/u);
      expect(JSON.parse(json)).toEqual({ title: `a${character}b` });
    },
  );

  test("writes ordinary text in any script, joiners included, as it is", () => {
    const value = { scripts };

    expect(terminalJson(value)).toBe(`${JSON.stringify(value, null, 2)}\n`);
  });

  test("writes no unsafe character raw, and parses back to the same value", () => {
    const value = { title: hostile, c1: "\u009B2J", del: "\u007F", ordinary };
    const json = terminalJson(value);

    expect(unsafeIn(json)).toEqual([]);
    expect(JSON.parse(json)).toEqual(value);
  });
});

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
