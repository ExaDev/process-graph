import {
  GraphSourceError,
  type SyncFilter,
  syncFilterSchema,
} from "@exadev/process-graph-source-contract";
import { z } from "zod";
import type { Scope } from "./identifiers.ts";

/**
 * Where the next page of a sync starts. A position is plain data, so a cursor resumes in any process.
 *
 * - `scope` is the scope identifier being read; a cursor is valid only for a request whose scope list contains it.
 * - For an owner scope, `repositories` is the `after` cursor GitHub gave for the page of the owner's repositories that holds the current one (`null` for the first), and `repository` is its index within that page. Repositories are listed by name, so the same listing page returns the same repositories while the owner is unchanged.
 * - `issues` is the `after` cursor for the next page of the current repository's issues (`null` for the first). Issues are listed by creation time unless a filter orders them otherwise, so new issues append and never shift a position.
 * - For a project scope, `items` is the `after` cursor for the next page of the board's items (`null` for the first).
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

const projectPositionSchema = z.strictObject({
  scope: z.string(),
  items: z.string().nullable(),
});

const positionSchema = z.union([
  repositoryPositionSchema,
  ownerPositionSchema,
  projectPositionSchema,
]);

/** A position within a repository scope. */
type RepositoryPosition = z.infer<typeof repositoryPositionSchema>;
/** A position within an owner scope. */
type OwnerPosition = z.infer<typeof ownerPositionSchema>;
/** A position within a project scope. */
type ProjectPosition = z.infer<typeof projectPositionSchema>;
/** A position within a sync. */
export type Position = RepositoryPosition | OwnerPosition | ProjectPosition;

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
    }
  | {
      readonly kind: "project";
      readonly scope: Extract<Scope, { readonly kind: "project" }>;
      readonly position: ProjectPosition;
    };

/**
 * The start of a scope.
 * @param scope - The scope.
 * @returns The scope with the position of its first page.
 */
export const startOf = (scope: Scope): Located => {
  if (scope.kind === "owner") {
    return {
      kind: "owner",
      scope,
      position: {
        scope: scope.id,
        repositories: null,
        repository: 0,
        issues: null,
      },
    };
  }
  if (scope.kind === "project") {
    return {
      kind: "project",
      scope,
      position: { scope: scope.id, items: null },
    };
  }

  return {
    kind: "repository",
    scope,
    position: { scope: scope.id, issues: null },
  };
};

/** The version tag inside every cursor, so a cursor from a later format is rejected rather than misread. */
const cursorFormat = 1;

/** A sync cursor: where the next page starts, and the filter it was issued under, absent for none. */
const envelopeSchema = z.strictObject({
  format: z.literal(cursorFormat),
  position: positionSchema,
  filter: syncFilterSchema.optional(),
});

/** A listing cursor: the parent scope whose children it pages (`null` for the top-level listing), and GitHub's cursor to read on after. */
const listingEnvelopeSchema = z.strictObject({
  format: z.literal(cursorFormat),
  parent: z.string().nullable(),
  after: z.string(),
});

/** A filter's fields in a fixed order, so two filters compare by value whatever order their fields were written in. */
const filterKey = (filter: SyncFilter | undefined): string =>
  JSON.stringify(
    filter === undefined
      ? null
      : [
          filter.states ?? null,
          filter.labels ?? null,
          filter.order === undefined
            ? null
            : [filter.order.field, filter.order.direction],
        ],
  );

/** Base64 of a small JSON envelope, which is printable and free of the line breaks an event-stream id must not contain. */
const encodeEnvelope = (envelope: unknown): string =>
  btoa(JSON.stringify(envelope));

/**
 * Encodes a position as an opaque cursor, together with the filter the sync runs under.
 * @param position - Where the next page starts.
 * @param filter - The sync's filter, or `undefined` for none.
 * @returns The cursor.
 */
export const encodeCursor = (
  position: Position,
  filter: SyncFilter | undefined,
): string =>
  encodeEnvelope({
    format: cursorFormat,
    position,
    ...(filter === undefined ? {} : { filter }),
  });

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
 * @param filter - The filter of the request it is used with.
 * @returns The position it encodes, with its scope.
 * @throws GraphSourceError with `bad-request` and `invalid-cursor` when it is not a cursor this adapter issued, was issued under another filter, names a scope the request does not contain, or has the shape of another kind of scope.
 */
export const decodeCursor = (
  cursor: string,
  scopes: readonly Scope[],
  filter: SyncFilter | undefined,
): Located => {
  const envelope = envelopeSchema.safeParse(
    parseJson(cursor, decodeBase64(cursor)),
  );
  if (!envelope.success) {
    throw invalidCursor(cursor, envelope.error.message);
  }
  if (filterKey(envelope.data.filter) !== filterKey(filter)) {
    throw invalidCursor(
      cursor,
      "it was issued under a different filter from the request's",
    );
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
  if (
    scope.kind === "repository" &&
    "issues" in position &&
    !("repositories" in position)
  ) {
    return { kind: "repository", scope, position };
  }
  if (scope.kind === "project" && "items" in position) {
    return { kind: "project", scope, position };
  }

  throw invalidCursor(
    cursor,
    `it does not fit the ${scope.kind} scope ${scope.id}`,
  );
};

/**
 * Encodes where a scope listing resumes.
 * @param parent - The parent scope whose children are listed, or `null` for the top-level listing.
 * @param after - GitHub's cursor to read on after.
 * @returns The cursor.
 */
export const encodeListingCursor = (
  parent: string | null,
  after: string,
): string => encodeEnvelope({ format: cursorFormat, parent, after });

/**
 * Decodes a listing cursor this adapter issued.
 * @param cursor - The cursor from an earlier listing page's `next`.
 * @param parent - The parent of the request it is used with, or `null` for the top-level listing.
 * @returns GitHub's cursor to read on after.
 * @throws GraphSourceError with `bad-request` and `invalid-cursor` when it is not a listing cursor this adapter issued, or was issued for another listing.
 */
export const decodeListingCursor = (
  cursor: string,
  parent: string | null,
): string => {
  const envelope = listingEnvelopeSchema.safeParse(
    parseJson(cursor, decodeBase64(cursor)),
  );
  if (!envelope.success) {
    throw invalidCursor(cursor, envelope.error.message);
  }
  if (envelope.data.parent !== parent) {
    throw invalidCursor(
      cursor,
      `it is for the listing of ${envelope.data.parent ?? "the top-level scopes"}`,
    );
  }

  return envelope.data.after;
};
