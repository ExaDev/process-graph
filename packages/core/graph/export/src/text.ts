import { terminalText } from "./terminal-text.ts";

/**
 * The Mermaid entity code for a character that would end or change the meaning of a label: quotes, statement and edge-label delimiters, the entity marker itself and HTML.
 */
const mermaidEntity = (character: string): string => {
  switch (character) {
    case "#":
      return "#35;";
    case '"':
      return "#quot;";
    case "<":
      return "#lt;";
    case ">":
      return "#gt;";
    case "&":
      return "#amp;";
    case ";":
      return "#59;";
    case "|":
      return "#124;";
    case ":":
      return "#58;";
    default:
      return character;
  }
};

/**
 * Text made safe to place inside any Mermaid label: a line break becomes a space, every control and invisible format character is written as its visible `\u{<hex>}` escape (see `terminalText`), and every character that Mermaid reads as syntax is written as its entity code, so a label from a source (an issue title, a repository name) can never break the diagram or act on the terminal it is printed to.
 * @param text - The label as written.
 * @returns The label as Mermaid source.
 */
export const mermaidText = (text: string): string =>
  terminalText(text.replaceAll(/[\r\n]/gu, " ")).replaceAll(
    /[#"<>&;|:]/gu,
    mermaidEntity,
  );

/**
 * A Graphviz DOT double-quoted string: line breaks written as DOT's own centred line break, every control and invisible format character as its visible `\u{<hex>}` escape (see `terminalText`), then backslashes, the escapes' included, and quotes escaped. Any identifier or label is valid DOT once quoted this way, and reads back as the escaped text.
 * @param text - The text as written.
 * @returns The quoted DOT string, quotes included.
 */
export const dotString = (text: string): string =>
  `"${text
    .split(/\r?\n/u)
    .map((line) =>
      terminalText(line).replaceAll("\\", "\\\\").replaceAll('"', '\\"'),
    )
    .join("\\n")}"`;
