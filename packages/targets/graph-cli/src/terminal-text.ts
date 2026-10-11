/**
 * The characters that must never reach a terminal as they are, by Unicode general category: controls (`Cc`, where ESC starts the sequences that clear the screen, move the cursor or, through OSC 52, set the clipboard, and the C1 controls some terminals read as the same sequences), format characters (`Cf`, which holds every bidirectional control, the invisible operators, the soft hyphen, the interlinear annotation characters and the tag characters, all of which reorder, hide or change what is shown), the line and paragraph separators (`Zl`, `Zp`), and the unassigned and private-use code points (`Cn`, `Co`), which no font shows reliably. Text from a source (an issue title, a label, an actor's name) can carry any of them. A category, not a list of ranges, so a character Unicode adds to one of them is covered without a change here.
 *
 * Three are allowed: line feed and tab, which every text output uses, and the zero-width non-joiner and joiner (U+200C, U+200D), formats that emoji sequences (a family, a profession) and scripts such as Persian, Hindi and Malayalam need to be written correctly, and that cannot reorder or hide text on their own.
 */
const unsafeCharacters =
  /[[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cn}\p{Co}]--[\n\t\u200C\u200D]]/gv;

/**
 * Whether a character is one of the unsafe ones (see `unsafeCharacters`).
 * @param character - One character: one code point, which may be two UTF-16 code units.
 * @returns Whether it must be escaped.
 */
export const isUnsafeCharacter = (character: string): boolean =>
  character.replaceAll(unsafeCharacters, "") !== character;

/** Code points are written in hexadecimal. */
const hexadecimal = 16;

/** A JSON `\u` escape always has four hexadecimal digits. */
const jsonEscapeDigits = 4;

/**
 * A character's code point.
 * @param character - One character, as the unsafe-character pattern matches it.
 * @returns Its code point.
 * @throws Error when given an empty string, which the pattern never matches.
 */
const codePointOf = (character: string): number => {
  const point = character.codePointAt(0);
  if (point === undefined) {
    throw new Error("an unsafe character match was empty");
  }

  return point;
};

/**
 * Text made safe to write to a terminal. Each unsafe character (see `unsafeCharacters`) is written as the visible escape `\u{<hex>}` of its code point, such as `\u{1b}` for ESC, `\u{202e}` for a right-to-left override or `\u{e0041}` for a tag character, so nothing is lost and nothing acts on the terminal. Line feed, tab, the zero-width joiners and every other character, accented letters, CJK, Arabic and emoji included, pass through. A literal `\u{...}` already in the text is left as it is, so the escaped form is for reading, not for reversing.
 * @param text - The text as written.
 * @returns The text with every unsafe character escaped.
 */
export const terminalText = (text: string): string =>
  text.replaceAll(
    unsafeCharacters,
    (character) => `\\u{${codePointOf(character).toString(hexadecimal)}}`,
  );

/**
 * A value as JSON that is also safe to write to a terminal. `JSON.stringify` escapes the C0 controls but writes every other unsafe character (see `unsafeCharacters`) as it is; this writes those as `\u` escapes too, a surrogate pair for a code point beyond the Basic Multilingual Plane, which leaves the JSON, and every value parsed from it, exactly the same.
 * @param value - The value to write.
 * @returns The JSON text, indented by two spaces and ending in a line break.
 */
export const terminalJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2).replaceAll(unsafeCharacters, (character) =>
    character
      .split("")
      .map(
        (unit) =>
          `\\u${unit.charCodeAt(0).toString(hexadecimal).padStart(jsonEscapeDigits, "0")}`,
      )
      .join(""),
  )}\n`;
