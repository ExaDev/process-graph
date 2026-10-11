import { withEventMeta } from "@orpc/client";
import type { ORPCErrorConstructorMap } from "@orpc/contract";
import {
  type ContractedRouter,
  type DefaultInitialContext,
  implement,
} from "@orpc/server";
import { graphSourceContract } from "./contract.ts";
import { GraphSourceError } from "./errors.ts";
import { paginate } from "./paginate.ts";
import type {
  ScopeListing,
  SyncFilter,
  SyncInput,
  SyncPage,
} from "./schema.ts";

/** One request for a page, as a pager receives it. */
export interface PageRequest {
  /** The scope identifiers to read, in order. */
  readonly scope: SyncInput["scope"];
  /** Where to start: the `next` of the page before, or `undefined` for the first page. */
  readonly cursor: string | undefined;
  /** The caller's abort signal. A pager passes it to every request it makes and stops when it fires. */
  readonly signal: AbortSignal | undefined;
  /** What narrows and orders each scope's listing; absent or `undefined`, nothing narrows it. A cursor issued under one filter is not valid under another. */
  readonly filter?: SyncFilter | undefined;
}

/** One request for a page of a scope listing. */
export interface ListingRequest {
  /** Where to start: the `next` of the page before, or `undefined` for the first page. */
  readonly cursor: string | undefined;
  /** The caller's abort signal, passed to every request the listing makes. */
  readonly signal: AbortSignal | undefined;
}

/** One request for a page of the scopes inside a scope. */
export interface ChildrenRequest extends ListingRequest {
  /** The scope identifier whose child scopes to list. */
  readonly scope: string;
}

/**
 * How a source lists the scopes a person can choose to sync, one page at a time. Cursors follow the pager's rules: stable, holding no in-memory state, and valid only for the listing (and parent) that issued them, so a foreign one throws `GraphSourceError` with `bad-request` and `invalid-cursor`.
 */
export interface GraphSourceScopes {
  /**
   * Lists the top-level scopes the credentials reach.
   * @param request - The cursor to start after, and the abort signal.
   * @returns One page of entries, with `next` absent on the last.
   * @throws GraphSourceError for a failure that ends the call.
   */
  readonly roots: (request: ListingRequest) => Promise<ScopeListing>;
  /**
   * Lists the scopes inside one scope. A parent that does not exist, or that the credentials cannot see, is a gap on an empty page; a scope with nothing inside it is an empty page; a parent that is not a scope identifier of this source throws `bad-request` with `invalid-scope`.
   * @param request - The parent scope, the cursor to start after, and the abort signal.
   * @returns One page of entries, with `next` absent on the last.
   * @throws GraphSourceError for a failure that ends the call.
   */
  readonly children: (request: ChildrenRequest) => Promise<ScopeListing>;
}

/**
 * What an adapter implements: one page at a time. `createGraphSourceRouter` builds the whole port on it, so paging, streaming, resumption and error mapping behave identically for every source.
 *
 * A pager's cursors must be stable: the same scope and cursor return the same page while the source is unchanged, and a cursor never names a position relative to state held in memory, so a sync resumes in a different process. A cursor the pager did not issue, or one from a different scope list, throws `GraphSourceError` with `bad-request` and `invalid-cursor`; a scope identifier it cannot parse throws `bad-request` and `invalid-scope`.
 */
export interface GraphSourcePager {
  /** The identifier prefix this source emits, such as `github`. */
  readonly source: string;
  /**
   * Reads one page.
   * @param request - The scope, the cursor to start after, and the abort signal.
   * @returns The page, with `next` absent when it is the last.
   * @throws GraphSourceError for a failure that ends the call.
   */
  readonly page: (request: PageRequest) => Promise<SyncPage>;
  /** Lists the scopes a person can choose from. Absent, the source offers no listing and the router answers its procedures with `NOT_IMPLEMENTED`. */
  readonly scopes?: GraphSourceScopes;
}

const os = implement(graphSourceContract);

/** The implemented `GraphSource` router: serve it over any oRPC transport, or call it in process with `createRouterClient`. */
export type GraphSourceRouter = ContractedRouter<
  typeof graphSourceContract,
  DefaultInitialContext
>;

type V1Errors = ORPCErrorConstructorMap<
  (typeof graphSourceContract.v1.describe)["~orpc"]["errorMap"]
>;

/** Rethrows a pager's `GraphSourceError` as the contract's typed oRPC error; anything else propagates unchanged. */
const toContractError = (
  error: unknown,
  errors: Readonly<V1Errors>,
): unknown => {
  if (!(error instanceof GraphSourceError)) {
    return error;
  }
  const { failure } = error;
  if (failure.kind === "unauthorised") {
    return errors.UNAUTHORIZED({
      message: failure.message,
      data: {},
      cause: error,
    });
  }
  if (failure.kind === "rate-limited") {
    return errors.TOO_MANY_REQUESTS({
      message: failure.message,
      data: failure.resetAt === undefined ? {} : { resetAt: failure.resetAt },
      cause: error,
    });
  }

  return errors.BAD_REQUEST({
    message: failure.message,
    data: { reason: failure.reason, value: failure.value },
    cause: error,
  });
};

/** Runs one call into the pager after checking the signal, as the contract's typed error when it fails. */
const guarded = async <T>(
  signal: AbortSignal | undefined,
  errors: Readonly<V1Errors>,
  read: () => Promise<T>,
): Promise<T> => {
  signal?.throwIfAborted();
  try {
    return await read();
  } catch (error) {
    throw toContractError(error, errors);
  }
};

/** Reads one page from the pager, as the contract's typed error when it fails. */
const readPage = async (
  pager: GraphSourcePager,
  request: Readonly<PageRequest>,
  errors: Readonly<V1Errors>,
): Promise<SyncPage> =>
  guarded(request.signal, errors, async () => pager.page(request));

type ListingErrors = ORPCErrorConstructorMap<
  (typeof graphSourceContract.v1.scopes.roots)["~orpc"]["errorMap"]
>;

/** The pager's scope listing, or the contract's `NOT_IMPLEMENTED` when it has none. */
const listingOf = (
  pager: GraphSourcePager,
  errors: Readonly<ListingErrors>,
): GraphSourceScopes => {
  if (pager.scopes === undefined) {
    throw errors.NOT_IMPLEMENTED({
      message: `The ${pager.source} source does not list its scopes.`,
      data: {},
    });
  }

  return pager.scopes;
};

/**
 * Builds the `GraphSource` router over a pager. Serve it over any oRPC transport, or call it in process with `createRouterClient`.
 * @param pager - The adapter's page reader.
 * @returns The implemented router for `graphSourceContract`.
 */
export const createGraphSourceRouter = (
  pager: GraphSourcePager,
): GraphSourceRouter =>
  os.router({
    v1: {
      describe: os.v1.describe.handler(() => ({ source: pager.source })),
      sync: {
        page: os.v1.sync.page.handler(async ({ input, signal, errors }) =>
          readPage(
            pager,
            {
              scope: input.scope,
              cursor: input.after,
              signal,
              filter: input.filter,
            },
            errors,
          ),
        ),
        stream: os.v1.sync.stream.handler(async function* ({
          input,
          signal,
          lastEventId,
          errors,
        }) {
          const pages = paginate(input.after ?? lastEventId, async (cursor) =>
            readPage(
              pager,
              { scope: input.scope, cursor, signal, filter: input.filter },
              errors,
            ),
          );
          for await (const page of pages) {
            yield page.next === undefined
              ? page
              : withEventMeta(page, { id: page.next });
          }
        }),
      },
      scopes: {
        roots: os.v1.scopes.roots.handler(async ({ input, signal, errors }) => {
          const listing = listingOf(pager, errors);

          return guarded(signal, errors, async () =>
            listing.roots({ cursor: input.after, signal }),
          );
        }),
        children: os.v1.scopes.children.handler(
          async ({ input, signal, errors }) => {
            const listing = listingOf(pager, errors);

            return guarded(signal, errors, async () =>
              listing.children({
                scope: input.scope,
                cursor: input.after,
                signal,
              }),
            );
          },
        ),
      },
    },
  });
