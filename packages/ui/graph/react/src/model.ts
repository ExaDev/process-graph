import type {
  GraphStoreClient,
  StoredModel,
} from "@exadev/process-graph-store-contract";
import { useEffect, useState } from "react";

/** Where a model being followed from a store stands. */
export type ModelState =
  | { readonly status: "loading" }
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

/**
 * Loads a model from a store and follows it: every change the store reports loads the model again, so the result always reflects the store's latest revision. It subscribes before the first load, so no change between the two is missed.
 * @param client - A `GraphStore` client, over any transport. Keep it stable between renders.
 * @param modelId - The model to follow.
 * @returns `loading` until the first load, then `loaded` with the model, its overlay and revision, or `failed` with the error a load or the subscription ended with (a model that does not exist, or was deleted, fails with the store's `NOT_FOUND`).
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
      const stored = await client.v1.models.load({ modelId }, { signal });
      settle({ status: "loaded", stored });

      return stored.revision;
    };
    const follow = async (): Promise<void> => {
      const changes = await client.v1.changes({ modelId }, { signal });
      let loaded = await load();
      for await (const change of changes) {
        // The subscription opened before the first load, so it can report a change that load already saw; revisions only grow, so anything newer than the loaded revision is not yet shown. `missed` carries no revision and always loads again. A deleted model's load fails with NOT_FOUND, which ends the subscription with the state to show.
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
