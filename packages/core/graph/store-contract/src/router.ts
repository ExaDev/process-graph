import type { ORPCErrorConstructorMap } from "@orpc/contract";
import { type ContractedRouter, implement } from "@orpc/server";
import { graphStoreContract } from "./contract.ts";
import { GraphStoreError } from "./errors.ts";
import type { GraphStore } from "./store.ts";

const os = implement(graphStoreContract);

type V1Errors = ORPCErrorConstructorMap<
  (typeof graphStoreContract.v1.models.load)["~orpc"]["errorMap"]
>;

/** Rethrows a store's `GraphStoreError` as the contract's typed oRPC error; anything else propagates unchanged. */
const toContractError = (
  error: unknown,
  errors: Readonly<V1Errors>,
): unknown => {
  if (!(error instanceof GraphStoreError)) {
    return error;
  }
  const { failure } = error;
  if (failure.kind === "not-found") {
    return errors.NOT_FOUND({
      message: error.message,
      data:
        failure.element === undefined
          ? { modelId: failure.modelId }
          : { modelId: failure.modelId, element: failure.element },
      cause: error,
    });
  }

  return errors.UNPROCESSABLE_CONTENT({
    message: error.message,
    data: { issues: failure.issues },
    cause: error,
  });
};

/** Runs one store call: refuses an already-aborted signal before touching the store, and maps the store's failures to the contract's errors. */
const call = async <T>(
  signal: AbortSignal | undefined,
  errors: Readonly<V1Errors>,
  operation: () => Promise<T>,
): Promise<T> => {
  signal?.throwIfAborted();
  try {
    return await operation();
  } catch (error) {
    throw toContractError(error, errors);
  }
};

/**
 * Builds the `GraphStore` router over a store. Serve it over any oRPC transport, or call it in process with `createRouterClient`.
 *
 * `changes` subscribes to the store's feed before it reads the model's revision and before it returns, so no change is lost between the two, and a caller holding the iterator is already subscribed. When the caller names a revision `since` and the model is no longer at it, the first event is `missed`; every later change follows as it commits.
 * @param store - The adapter.
 * @returns The implemented router for `graphStoreContract`.
 */
export const createGraphStoreRouter = (store: GraphStore): GraphStoreRouter =>
  os.router({
    v1: {
      models: {
        list: os.v1.models.list.handler(async ({ signal, errors }) =>
          call(signal, errors, async () => store.listModels({ signal })),
        ),
        save: os.v1.models.save.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () => ({
            revision: await store.saveModel({ ...input, signal }),
          })),
        ),
        load: os.v1.models.load.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () =>
            store.loadModel({ ...input, signal }),
          ),
        ),
        delete: os.v1.models.delete.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () => {
            const revision = await store.deleteModel({ ...input, signal });

            return revision === undefined
              ? { deleted: false as const }
              : { deleted: true as const, revision };
          }),
        ),
      },
      overlay: {
        set: os.v1.overlay.set.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () => ({
            revision: await store.applyOverlay({ ...input, signal }),
          })),
        ),
      },
      items: {
        upsert: os.v1.items.upsert.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () => ({
            revision: await store.upsertItems({ ...input, signal }),
          })),
        ),
      },
      query: {
        ready: os.v1.query.ready.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () => ({
            elements: await store.ready({ ...input, signal }),
          })),
        ),
        blockedChain: os.v1.query.blockedChain.handler(
          async ({ input, signal, errors }) =>
            call(signal, errors, async () => ({
              chain: await store.blockedChain({ ...input, signal }),
            })),
        ),
        impact: os.v1.query.impact.handler(async ({ input, signal, errors }) =>
          call(signal, errors, async () => ({
            impacted: await store.impact({ ...input, signal }),
          })),
        ),
      },
      changes: os.v1.changes.handler(async ({ input, signal, errors }) => {
        // Subscribe before anything is awaited and before the iterator is returned: a caller that has the iterator in hand is already subscribed, over any transport, so a write it makes next is never missed.
        const subscription = store.feed.subscribe(input.modelId, signal);
        let missed = false;
        try {
          if (input.since !== undefined) {
            const current = await call(signal, errors, async () =>
              store.revisionOf({ modelId: input.modelId, signal }),
            );
            missed = current !== input.since;
          }
        } catch (error) {
          subscription.close();
          throw error;
        }

        return (async function* () {
          try {
            if (missed) {
              yield { modelId: input.modelId, kind: "missed" as const };
            }
            yield* subscription;
          } finally {
            subscription.close();
          }
        })();
      }),
    },
  });

/** The router `createGraphStoreRouter` builds: every procedure of `graphStoreContract`, needing no initial context. */
export type GraphStoreRouter = ContractedRouter<
  typeof graphStoreContract,
  object
>;
