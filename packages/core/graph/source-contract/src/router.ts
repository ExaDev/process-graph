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
import type { SyncInput, SyncPage } from "./schema.ts";

/** One request for a page, as a pager receives it. */
export interface PageRequest {
  /** The scope identifiers to read, in order. */
  readonly scope: SyncInput["scope"];
  /** Where to start: the `next` of the page before, or `undefined` for the first page. */
  readonly cursor: string | undefined;
  /** The caller's abort signal. A pager passes it to every request it makes and stops when it fires. */
  readonly signal: AbortSignal | undefined;
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

/** Reads one page from the pager, as the contract's typed error when it fails. */
const readPage = async (
  pager: GraphSourcePager,
  request: Readonly<PageRequest>,
  errors: Readonly<V1Errors>,
): Promise<SyncPage> => {
  request.signal?.throwIfAborted();
  try {
    return await pager.page(request);
  } catch (error) {
    throw toContractError(error, errors);
  }
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
            { scope: input.scope, cursor: input.after, signal },
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
            readPage(pager, { scope: input.scope, cursor, signal }, errors),
          );
          for await (const page of pages) {
            yield page.next === undefined
              ? page
              : withEventMeta(page, { id: page.next });
          }
        }),
      },
    },
  });
