/**
 * The characters, as inclusive ranges, that must never reach a terminal as they are: the C0 controls except line feed and tab (ESC starts the sequences that clear the screen, move the cursor or, through OSC 52, set the clipboard), DEL, the C1 controls (which some terminals read as the same sequences), and the Unicode bidirectional and invisible format controls, which reorder or hide text so that what is shown differs from what is there. Text from a source (an issue title, a label, an actor's name) can carry any of them.
 */
const unsafeRanges: readonly (readonly [string, string])[] = [
  ["\u0000", "\u0008"],
  ["\u000B", "\u001F"],
  ["\u007F", "\u009F"],
  ["\u200B", "\u200F"],
  ["\u202A", "\u202E"],
  ["\u2060", "\u2064"],
  ["\u2066", "\u2069"],
  ["\uFEFF", "\uFEFF"],
];

/**
 * Whether a character is one of the unsafe ones (see `unsafeRanges`). Every range lies in the Basic Multilingual Plane, where comparing one-character strings compares their code points, and a character outside it is never unsafe.
 * @param character - One character.
 * @returns Whether it must be escaped.
 */
export const isUnsafeCharacter = (character: string): boolean =>
  unsafeRanges.some(([from, to]) => character >= from && character <= to);

/** Code points are written in hexadecimal. */
const hexadecimal = 16;

/** A JSON `\u` escape always has four hexadecimal digits. */
const jsonEscapeDigits = 4;

/**
 * The text with each unsafe character replaced by an escape of its code point.
 * @param text - The text as written.
 * @param escape - The escape for a code point given in lower-case hexadecimal.
 * @returns The escaped text.
 */
const escapeUnsafe = (text: string, escape: (hex: string) => string): string =>
  Array.from(text, (character) =>
    isUnsafeCharacter(character)
      ? escape(character.charCodeAt(0).toString(hexadecimal))
      : character,
  ).join("");

/**
 * Text made safe to write to a terminal. Each unsafe character (see `unsafeRanges`) is written as the visible escape `\u{<hex>}`, such as `\u{1b}` for ESC or `\u{202e}` for a right-to-left override, so nothing is lost and nothing acts on the terminal. Line feed and tab pass through, as does every other character, accented letters, CJK and emoji included. A literal `\u{...}` already in the text is left as it is, so the escaped form is for reading, not for reversing.
 * @param text - The text as written.
 * @returns The text with every unsafe character escaped.
 */
export const terminalText = (text: string): string =>
  escapeUnsafe(text, (hex) => `\\u{${hex}}`);

/**
 * A value as JSON that is also safe to write to a terminal. `JSON.stringify` escapes the C0 controls but writes DEL, the C1 controls and the format controls as they are; this writes those as `\u` escapes too, which leaves the JSON, and every value parsed from it, exactly the same.
 * @param value - The value to write.
 * @returns The JSON text, indented by two spaces and ending in a line break.
 */
export const terminalJson = (value: unknown): string =>
  `${escapeUnsafe(
    JSON.stringify(value, null, 2),
    (hex) => `\\u${hex.padStart(jsonEscapeDigits, "0")}`,
  )}\n`;
