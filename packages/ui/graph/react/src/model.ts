import type {
  GraphStoreClient,
  StoredModel,
} from "@exadev/process-graph-store-contract";
import { ORPCError } from "@orpc/client";
import { useEffect, useState } from "react";

/**
 * Where a model being followed from a store stands. `missing` is a model the store does not have, yet or any more: it is still followed, so the first write that creates it, such as a sync, loads it.
 */
export type ModelState =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "loaded"; readonly stored: StoredModel }
  | { readonly status: "failed"; readonly error: unknown };

/** The part of the `GraphStore` client `useModel` calls: loading a model and following its changes. */
export interface ModelClient {
  readonly v1: {
    readonly models: Pick<GraphStoreClient["v1"]["models"], "load">;
    readonly changes: GraphStoreClient["v1"]["changes"];
  };
}

const loading: ModelState = { status: "loading" };
const missing: ModelState = { status: "missing" };

/** Revisions are positive, so every change to a model is newer than this: the revision a missing model is treated as having. */
const noRevision = 0;

/**
 * Loads a model from a store and follows it: every change the store reports loads the model again, so the result always reflects the store's latest revision. It subscribes before the first load, so no change between the two is missed. A model the store does not have is `missing` and still followed, so a model that is created later, or deleted and saved again, is loaded when it is.
 * @param client - A `GraphStore` client, over any transport. Keep it stable between renders.
 * @param modelId - The model to follow.
 * @returns `loading` until the first load; then `loaded` with the model, its overlay and revision, `missing` while the store has no such model (its load answers `NOT_FOUND`), or `failed` with any other error a load or the subscription ended with.
 */
export const useModel = (client: ModelClient, modelId: string): ModelState => {
  const [state, setState] = useState<{
    readonly client: ModelClient;
    readonly modelId: string;
    readonly value: ModelState;
  }>({ client, modelId, value: loading });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const settle = (value: ModelState): void => {
      setState({ client, modelId, value });
    };
    const load = async (): Promise<number> => {
      try {
        const stored = await client.v1.models.load({ modelId }, { signal });
        settle({ status: "loaded", stored });

        return stored.revision;
      } catch (error) {
        if (error instanceof ORPCError && error.code === "NOT_FOUND") {
          settle(missing);

          return noRevision;
        }
        throw error;
      }
    };
    const follow = async (): Promise<void> => {
      const changes = await client.v1.changes({ modelId }, { signal });
      let loaded = await load();
      for await (const change of changes) {
        // The subscription opened before the first load, so it can report a change that load already saw; revisions only grow, so anything newer than the loaded revision is not yet shown. `missed` carries no revision and always loads again. A deleted model's load answers NOT_FOUND, which shows it missing and keeps following it.
        if (change.kind === "missed" || change.revision > loaded) {
          loaded = await load();
        }
      }
    };
    follow().catch((error: unknown) => {
      // An abort is this effect being cleaned up, not a failure of the model.
      if (!signal.aborted) {
        settle({ status: "failed", error });
      }
    });

    return () => {
      controller.abort();
    };
  }, [client, modelId]);

  return state.client === client && state.modelId === modelId
    ? state.value
    : loading;
};
