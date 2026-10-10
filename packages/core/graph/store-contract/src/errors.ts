import type { Issue } from "@exadev/process-graph-schema";

/** Why a store operation failed, as data. */
export type GraphStoreFailure =
  | {
      /** The model does not exist, or `element` is not one of its elements. */
      readonly kind: "not-found";
      readonly modelId: string;
      readonly element?: string;
    }
  | {
      /** The change would leave the model or its overlay invalid, as `validate` and `validateOverlay` report it; nothing was written. */
      readonly kind: "invalid";
      readonly issues: readonly Issue[];
    };

/**
 * The one error a `GraphStore` implementation throws for an expected failure. `createGraphStoreRouter` turns it into the contract's typed oRPC error, so every store reports failures the same way over every transport.
 */
export class GraphStoreError extends Error {
  /** What went wrong. */
  readonly failure: GraphStoreFailure;

  /**
   * @param failure - What went wrong.
   */
  constructor(failure: GraphStoreFailure) {
    super(
      failure.kind === "not-found"
        ? failure.element === undefined
          ? `No model "${failure.modelId}"`
          : `Model "${failure.modelId}" has no element "${failure.element}"`
        : `Invalid change: ${failure.issues.map((issue) => issue.message).join("; ")}`,
    );
    this.name = "GraphStoreError";
    this.failure = failure;
  }
}
