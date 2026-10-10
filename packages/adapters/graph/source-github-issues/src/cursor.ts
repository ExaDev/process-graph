import { GraphSourceError } from "@exadev/process-graph-source-contract";
import { z } from "zod";
import type { Scope } from "./identifiers.ts";

/**
 * Where the next page of a sync starts. A position is plain data, so a cursor resumes in any process.
 *
 * - `scope` is the scope identifier being read; a cursor is valid only for a request whose scope list contains it.
 * - For an owner scope, `repositories` is the `after` cursor GitHub gave for the page of the owner's repositories that holds the current one (`null` for the first), and `repository` is its index within that page. Repositories are listed by name, so the same listing page returns the same repositories while the owner is unchanged.
 * - `issues` is the `after` cursor for the next page of the current repository's issues (`null` for the first). Issues are listed by creation time, so new issues append and never shift a position.
 */
const repositoryPositionSchema = z.strictObject({
  scope: z.string(),
  issues: z.string().nullable(),
});

const ownerPositionSchema = z.strictObject({
  scope: z.string(),
  repositories: z.string().nullable(),
  repository: z.int().nonnegative(),
  issues: z.string().nullable(),
});

const positionSchema = z.union([repositoryPositionSchema, ownerPositionSchema]);

/** A position within a repository scope. */
type RepositoryPosition = z.infer<typeof repositoryPositionSchema>;
/** A position within an owner scope. */
type OwnerPosition = z.infer<typeof ownerPositionSchema>;
/** A position within a sync. */
export type Position = RepositoryPosition | OwnerPosition;

/** A position together with the scope it is in, matched by kind. `kind` repeats the scope's kind so the pair narrows as one. */
export type Located =
  | {
      readonly kind: "repository";
      readonly scope: Extract<Scope, { readonly kind: "repository" }>;
      readonly position: RepositoryPosition;
    }
  | {
      readonly kind: "owner";
      readonly scope: Extract<Scope, { readonly kind: "owner" }>;
      readonly position: OwnerPosition;
    };

/**
 * The start of a scope.
 * @param scope - The scope.
 * @returns The scope with the position of its first page.
 */
export const startOf = (scope: Scope): Located =>
  scope.kind === "owner"
    ? {
        kind: "owner",
        scope,
        position: {
          scope: scope.id,
          repositories: null,
          repository: 0,
          issues: null,
        },
      }
    : {
        kind: "repository",
        scope,
        position: { scope: scope.id, issues: null },
      };

/** The version tag inside every cursor, so a cursor from a later format is rejected rather than misread. */
const cursorFormat = 1;

const envelopeSchema = z.strictObject({
  format: z.literal(cursorFormat),
  position: positionSchema,
});

/**
 * Encodes a position as an opaque cursor: base64 of a small JSON envelope, which is printable and free of the line breaks an event-stream id must not contain.
 * @param position - Where the next page starts.
 * @returns The cursor.
 */
export const encodeCursor = (position: Position): string =>
  btoa(JSON.stringify({ format: cursorFormat, position }));

const invalidCursor = (cursor: string, message: string): GraphSourceError =>
  new GraphSourceError({
    kind: "bad-request",
    message: `"${cursor}" is not a cursor this source issued: ${message}`,
    reason: "invalid-cursor",
    value: cursor,
  });

/** Parses JSON from a decoded cursor, reporting malformed text as an invalid cursor. */
const parseJson = (cursor: string, text: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch (error) {
    throw invalidCursor(
      cursor,
      error instanceof Error ? error.message : "not JSON",
    );
  }
};

/** Decodes base64, reporting text outside the base64 alphabet as an invalid cursor. */
const decodeBase64 = (cursor: string): string => {
  try {
    return atob(cursor);
  } catch {
    throw invalidCursor(cursor, "not base64");
  }
};

/**
 * Decodes a cursor this adapter issued.
 * @param cursor - The cursor from an earlier page's `next`.
 * @param scopes - The scopes of the request it is used with.
 * @returns The position it encodes, with its scope.
 * @throws GraphSourceError with `bad-request` and `invalid-cursor` when it is not a cursor this adapter issued, names a scope the request does not contain, or has the shape of the other kind of scope.
 */
export const decodeCursor = (
  cursor: string,
  scopes: readonly Scope[],
): Located => {
  const envelope = envelopeSchema.safeParse(
    parseJson(cursor, decodeBase64(cursor)),
  );
  if (!envelope.success) {
    throw invalidCursor(cursor, envelope.error.message);
  }
  const { position } = envelope.data;
  const scope = scopes.find((candidate) => candidate.id === position.scope);
  if (scope === undefined) {
    throw invalidCursor(
      cursor,
      `it is for scope ${position.scope}, which the request does not contain`,
    );
  }
  if (scope.kind === "owner" && "repositories" in position) {
    return { kind: "owner", scope, position };
  }
  if (scope.kind === "repository" && !("repositories" in position)) {
    return { kind: "repository", scope, position };
  }

  throw invalidCursor(
    cursor,
    `it does not fit the ${scope.kind} scope ${scope.id}`,
  );
};
