/**
 * The Mermaid entity code for a character that would end or change the meaning of a label: quotes, statement and edge-label delimiters, the entity marker itself and HTML. A line break becomes a space, since every label is one line.
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
    case "\r":
    case "\n":
      return " ";
    default:
      return character;
  }
};

/**
 * Text made safe to place inside any Mermaid label: every character that Mermaid reads as syntax is written as its entity code, so a label from a source (an issue title, a repository name) can never break the diagram.
 * @param text - The label as written.
 * @returns The label as Mermaid source.
 */
export const mermaidText = (text: string): string =>
  text.replaceAll(/[#"<>&;|:\r\n]/gu, mermaidEntity);

/**
 * A Graphviz DOT double-quoted string: backslashes and quotes escaped, line breaks written as DOT's own centred line break. Any identifier or label is valid DOT once quoted this way.
 * @param text - The text as written.
 * @returns The quoted DOT string, quotes included.
 */
export const dotString = (text: string): string =>
  `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll(/\r?\n/gu, "\\n")}"`;
