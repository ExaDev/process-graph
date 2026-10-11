import { GraphSourceError } from "./errors.ts";
import type {
  GraphSourcePager,
  GraphSourceScopes,
  ListingRequest,
  PageRequest,
} from "./router.ts";
import type {
  ScopeEntry,
  ScopeListing,
  SyncFilter,
  SyncPage,
} from "./schema.ts";

/** A page's content without its cursor, which the fake derives. */
export type FakePage = Omit<SyncPage, "next">;

/** What the in-memory fake serves. */
export interface FakeGraphSourceOptions {
  /** The identifier prefix, such as `fake`. Every scope identifier must start with it and a colon. */
  readonly source: string;
  /** The pages of each known scope, keyed by scope identifier. A scope with no pages is known and empty. */
  readonly scopes: Readonly<Record<string, readonly FakePage[]>>;
  /** What `scopes.roots` lists, in order; nothing when absent. */
  readonly roots?: readonly ScopeEntry[];
  /** What `scopes.children` lists for each parent scope, in order. A parent named here, in `scopes` or among `roots` is known; any other parent is a `not-found` gap. */
  readonly children?: Readonly<Record<string, readonly ScopeEntry[]>>;
  /** Entries per listing page, a positive integer; absent, a listing is one page. */
  readonly listingPageSize?: number;
}

/** One position in a sync: a page of a known scope, or the single gap page of an unknown one. */
interface Position {
  readonly scope: string;
  readonly index: number;
}

const gapIndex = -1;
const cursorPattern =
  /^(?<scope>[^@;]+)@(?<index>-1|0|[1-9]\d*)(?:;(?<filter>.+))?$/u;

/** A filter as one string with its fields in a fixed order, so the same filter always gives the same cursor and two filters compare by value. */
const filterKey = (filter: SyncFilter | undefined): string | undefined =>
  filter === undefined
    ? undefined
    : encodeURIComponent(
        JSON.stringify([
          filter.states ?? null,
          filter.labels ?? null,
          filter.order === undefined
            ? null
            : [filter.order.field, filter.order.direction],
        ]),
      );

const encodeCursor = (position: Position, filter: string | undefined): string =>
  `${encodeURIComponent(position.scope)}@${String(position.index)}${filter === undefined ? "" : `;${filter}`}`;

/**
 * Applies a filter to a page as though the source had listed only the activities it keeps: an activity is kept when its run state is one of `states` and it carries one of `labels`. The fake's activities carry no labels, so a filter naming labels keeps none. What a dropped activity was part of (transitions, relations, run state) is dropped with it. `order` does not change the fake's fixed page order.
 */
const filtered = (page: FakePage, filter: SyncFilter | undefined): FakePage => {
  if (filter === undefined) {
    return page;
  }
  const { states, labels } = filter;
  const kept = new Set(
    page.activities
      .filter((activity) => {
        const state = page.overlay[activity.id];
        const stateKept =
          states === undefined ||
          (state !== undefined && states.some((wanted) => wanted === state));

        return stateKept && labels === undefined;
      })
      .map((activity) => activity.id),
  );
  const dropped = new Set(
    page.activities
      .map((activity) => activity.id)
      .filter((id) => !kept.has(id)),
  );

  return {
    ...page,
    activities: page.activities.filter((activity) => kept.has(activity.id)),
    transitions: page.transitions.filter(
      (transition) =>
        !dropped.has(transition.source) && !dropped.has(transition.target),
    ),
    relations: page.relations.filter(
      (relation) => !dropped.has(relation.from) && !dropped.has(relation.to),
    ),
    overlay: Object.fromEntries(
      Object.entries(page.overlay).filter(([id]) => !dropped.has(id)),
    ),
  };
};

/** The cursor of a listing page: which listing (`roots`, or the encoded parent scope, which always holds an encoded colon) and the offset of the next entry. */
const listingCursorPattern = /^(?<listing>[^@]+)@(?<offset>[1-9]\d*)$/u;
const rootsListing = "roots";

const samePosition = (a: Position, b: Position): boolean =>
  a.scope === b.scope && a.index === b.index;

/**
 * The reference in-memory `GraphSourcePager`: a fixed set of pages per scope, served in scope order. A scope that is well formed but unknown yields one page holding a `not-found` gap, so a sync over several scopes still returns the rest. Cursors encode the scope identifier, page index and filter, so they are stable, resume in any instance built from the same pages, and are refused under a different filter. A filter is applied to each page as described at `filtered`.
 *
 * Its scope listing serves `roots` and `children` from the options, `listingPageSize` entries a page.
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
    filter: string | undefined,
  ): number => {
    if (cursor === undefined) {
      return 0;
    }
    const groups = cursorPattern.exec(cursor)?.groups;
    const after =
      groups?.scope === undefined ||
      groups.index === undefined ||
      groups.filter !== filter
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

  const read = ({ scope, cursor, signal, filter }: PageRequest): SyncPage => {
    signal?.throwIfAborted();
    const key = filterKey(filter);
    const positions = positionsOf(scope);
    const start = startOf(positions, cursor, key);
    const position = positions[start];
    if (position === undefined) {
      throw new Error(
        "unreachable: startOf returns an index within the positions",
      );
    }
    const page = filtered(pageAt(position), filter);

    return start === positions.length - 1
      ? page
      : { ...page, next: encodeCursor(position, key) };
  };

  const listingPageSize = options.listingPageSize;
  if (
    listingPageSize !== undefined &&
    (!Number.isInteger(listingPageSize) || listingPageSize < 1)
  ) {
    throw new RangeError(
      `listingPageSize must be a positive integer, not ${String(listingPageSize)}`,
    );
  }
  const roots = options.roots ?? [];
  const children = options.children ?? {};

  /** One page of `entries` from the cursor's offset, after checking the cursor belongs to `listing`. */
  const listingPage = (
    listing: string,
    entries: readonly ScopeEntry[],
    { cursor, signal }: ListingRequest,
  ): ScopeListing => {
    signal?.throwIfAborted();
    const size = listingPageSize ?? Math.max(entries.length, 1);
    const groups =
      cursor === undefined
        ? undefined
        : listingCursorPattern.exec(cursor)?.groups;
    const offset =
      cursor === undefined
        ? 0
        : groups?.listing === listing && groups.offset !== undefined
          ? Number(groups.offset)
          : undefined;
    // Only the offsets this fake hands out are cursors: a page boundary inside the listing.
    if (
      offset === undefined ||
      offset % size !== 0 ||
      (offset > 0 && offset >= entries.length)
    ) {
      throw new GraphSourceError({
        kind: "bad-request",
        message: `"${String(cursor)}" is not a cursor for this listing`,
        reason: "invalid-cursor",
        value: String(cursor),
      });
    }
    const end = offset + size;
    const page = { entries: entries.slice(offset, end), gaps: [] };

    return end < entries.length
      ? { ...page, next: `${listing}@${String(end)}` }
      : page;
  };

  const listing: GraphSourceScopes = {
    roots: async (request) =>
      Promise.resolve(request).then(() =>
        listingPage(rootsListing, roots, request),
      ),
    children: async (request) =>
      Promise.resolve(request).then(() => {
        const { scope } = request;
        if (!scope.startsWith(prefix) || scope.length === prefix.length) {
          throw new GraphSourceError({
            kind: "bad-request",
            message: `"${scope}" is not a ${source} scope identifier`,
            reason: "invalid-scope",
            value: scope,
          });
        }
        const known =
          Object.hasOwn(children, scope) ||
          Object.hasOwn(scopes, scope) ||
          roots.some((entry) => entry.scope === scope);
        // An unknown parent never had a page, so no cursor is valid for it.
        if (!known && request.cursor === undefined) {
          request.signal?.throwIfAborted();

          return {
            entries: [],
            gaps: [
              {
                target: scope,
                reason: "not-found",
                message: `${scope} does not exist`,
              },
            ],
          };
        }

        return listingPage(
          encodeURIComponent(scope),
          children[scope] ?? [],
          request,
        );
      }),
  };

  return {
    source,
    // Async, so a throw from `read` becomes a rejection, as it would from a source that reads over a network.
    page: async (request) => Promise.resolve(read(request)),
    scopes: listing,
  };
};
