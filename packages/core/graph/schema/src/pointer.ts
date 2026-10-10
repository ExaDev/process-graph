/** Encodes a schema issue path as an RFC 6901 JSON pointer, escaping `~` and `/` inside a segment. The empty path is the document itself, `""`. */
export const toPointer = (path: readonly PropertyKey[]): string =>
  path
    .map(
      (segment) =>
        `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");
