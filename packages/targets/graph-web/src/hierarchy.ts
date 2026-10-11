import type { GraphStoreClient } from "@exadev/process-graph-store-contract";
import { useEffect, useState } from "react";
import { failureOf } from "./failure.ts";

/** The part of the `GraphStore` client the hierarchy reads: the structural queries over `child-of` relations. */
export interface HierarchyClient {
  readonly v1: {
    readonly query: Pick<
      GraphStoreClient["v1"]["query"],
      "children" | "ancestors"
    >;
  };
}

/** An element's place in the hierarchy a source reports, as the store's relations hold it. */
export type Hierarchy =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      /** What the element is a sub-task of: the ancestors one relation away, in model order. */
      readonly parents: readonly string[];
      /** Its direct sub-tasks, in model order. */
      readonly children: readonly string[];
    }
  | { readonly status: "failed"; readonly message: string };

/** A parent is one `child-of` relation above its child. */
const parentDistance = 1;

const loading: Hierarchy = { status: "loading" };

/**
 * Reads an element's parents and children from the store's hierarchy queries, again whenever the model's revision changes, so a sync that brings a sub-issue or its parent shows at once.
 * @param store - The store client. Keep it stable between renders.
 * @param modelId - The model.
 * @param element - The element, which the model declares.
 * @param revision - The model's revision, so a change to the model reads the hierarchy again.
 * @returns `loading` until both queries answer, then the parents and children, or `failed` with what the store said.
 */
export const useHierarchy = (
  store: HierarchyClient,
  modelId: string,
  element: string,
  revision: number,
): Hierarchy => {
  const key = `${modelId}\n${element}\n${String(revision)}`;
  const [state, setState] = useState<{
    readonly key: string;
    readonly value: Hierarchy;
  }>({ key, value: loading });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      store.v1.query.ancestors({ modelId, element }, { signal }),
      store.v1.query.children({ modelId, element }, { signal }),
    ]).then(
      ([above, below]) => {
        setState({
          key,
          value: {
            status: "loaded",
            parents: above.ancestors
              .filter((link) => link.distance === parentDistance)
              .map((link) => link.element),
            children: below.children,
          },
        });
      },
      (error: unknown) => {
        // An abort is this effect being cleaned up, not a failure to read.
        if (!signal.aborted) {
          setState({
            key,
            value: { status: "failed", message: failureOf(error).message },
          });
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [store, modelId, element, key]);

  return state.key === key ? state.value : loading;
};
