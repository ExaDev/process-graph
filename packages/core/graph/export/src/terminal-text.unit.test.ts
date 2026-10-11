import { describe, expect, test } from "vitest";
import {
  isUnsafeCharacter,
  terminalJson,
  terminalText,
} from "./terminal-text.ts";

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
