import { GraphSourceError } from "./errors.ts";
import type { GraphSourcePager, PageRequest } from "./router.ts";
import type { SyncPage } from "./schema.ts";

/** A page's content without its cursor, which the fake derives. */
export type FakePage = Omit<SyncPage, "next">;

/** What the in-memory fake serves. */
export interface FakeGraphSourceOptions {
  /** The identifier prefix, such as `fake`. Every scope identifier must start with it and a colon. */
  readonly source: string;
  /** The pages of each known scope, keyed by scope identifier. A scope with no pages is known and empty. */
  readonly scopes: Readonly<Record<string, readonly FakePage[]>>;
}

/** One position in a sync: a page of a known scope, or the single gap page of an unknown one. */
interface Position {
  readonly scope: string;
  readonly index: number;
}

const gapIndex = -1;
const cursorPattern = /^(?<scope>[^@]+)@(?<index>-1|0|[1-9]\d*)$/u;

const encodeCursor = (position: Position): string =>
  `${encodeURIComponent(position.scope)}@${String(position.index)}`;

const samePosition = (a: Position, b: Position): boolean =>
  a.scope === b.scope && a.index === b.index;

/**
 * The reference in-memory `GraphSourcePager`: a fixed set of pages per scope, served in scope order. A scope that is well formed but unknown yields one page holding a `not-found` gap, so a sync over several scopes still returns the rest. Cursors encode the scope identifier and page index, so they are stable and resume in any instance built from the same pages.
 * @param options - The source prefix and the pages of each scope.
 * @returns A pager for `createGraphSourceRouter`.
 */
export const createFakeGraphSource = (
  options: FakeGraphSourceOptions,
): GraphSourcePager => {
  const { source, scopes } = options;
  const prefix = `${source}:`;

  const positionsOf = (scope: readonly string[]): readonly Position[] =>
    [...new Set(scope)].flatMap((id) => {
      if (!id.startsWith(prefix) || id.length === prefix.length) {
        throw new GraphSourceError({
          kind: "bad-request",
          message: `"${id}" is not a ${source} scope identifier`,
          reason: "invalid-scope",
          value: id,
        });
      }
      const pages = scopes[id];
      if (pages === undefined) {
        return [{ scope: id, index: gapIndex }];
      }

      // A known scope with no pages still answers with one empty page, so every scope occupies at least one position.
      return pages.length === 0
        ? [{ scope: id, index: 0 }]
        : pages.map((_, index) => ({ scope: id, index }));
    });

  const startOf = (
    positions: readonly Position[],
    cursor: string | undefined,
  ): number => {
    if (cursor === undefined) {
      return 0;
    }
    const groups = cursorPattern.exec(cursor)?.groups;
    const after =
      groups?.scope === undefined || groups.index === undefined
        ? undefined
        : {
            scope: decodeURIComponent(groups.scope),
            index: Number(groups.index),
          };
    const found =
      after === undefined
        ? -1
        : positions.findIndex((position) => samePosition(position, after));
    // The last position's page has no `next`, so a cursor naming it was not issued by this source.
    if (found === -1 || found === positions.length - 1) {
      throw new GraphSourceError({
        kind: "bad-request",
        message: `"${cursor}" is not a cursor for this scope`,
        reason: "invalid-cursor",
        value: cursor,
      });
    }

    return found + 1;
  };

  const pageAt = (position: Position): FakePage => {
    const page = scopes[position.scope]?.[position.index];
    if (page !== undefined) {
      return page;
    }

    return {
      participants: [],
      activities: [],
      transitions: [],
      relations: [],
      overlay: {},
      gaps:
        position.index === gapIndex
          ? [
              {
                target: position.scope,
                reason: "not-found",
                message: `${position.scope} does not exist`,
              },
            ]
          : [],
    };
  };

  const read = ({ scope, cursor, signal }: PageRequest): SyncPage => {
    signal?.throwIfAborted();
    const positions = positionsOf(scope);
    const start = startOf(positions, cursor);
    const position = positions[start];
    if (position === undefined) {
      throw new Error(
        "unreachable: startOf returns an index within the positions",
      );
    }
    const page = pageAt(position);

    return start === positions.length - 1
      ? page
      : { ...page, next: encodeCursor(position) };
  };

  return {
    source,
    // Async, so a throw from `read` becomes a rejection, as it would from a source that reads over a network.
    page: async (request) => Promise.resolve(read(request)),
  };
};
