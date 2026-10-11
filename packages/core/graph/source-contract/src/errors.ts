import type { BadRequestReason } from "./schema.ts";

/**
 * The failures that end a sync call, as a closed union a caller can switch on exhaustively. What a source can still partly read is not a failure: it arrives as a `Gap` in the page.
 *
 * - `unauthorised`: the source rejected the credentials outright, or none could be had for it.
 * - `rate-limited`: the source refused the request until `resetAt` (an ISO 8601 instant) when it said so. Resume from the last page's `next` after that.
 * - `bad-request`: the cursor or a scope identifier is not one this source issued or understands.
 */
export type GraphSourceFailure =
  | { readonly kind: "unauthorised"; readonly message: string }
  | {
      readonly kind: "rate-limited";
      readonly message: string;
      readonly resetAt: string | undefined;
    }
  | {
      readonly kind: "bad-request";
      readonly message: string;
      readonly reason: BadRequestReason;
      readonly value: string;
    };

/**
 * Thrown by a `GraphSourcePager` to end a call with a typed failure. `createGraphSourceRouter` turns it into the contract's matching oRPC error, so it reaches a client over any transport as `UNAUTHORIZED`, `TOO_MANY_REQUESTS` or `BAD_REQUEST` with its data.
 */
export class GraphSourceError extends Error {
  /** The failure, with the detail a caller branches on. */
  readonly failure: GraphSourceFailure;

  /**
   * @param failure - The failure this error carries; its `message` becomes the error's message.
   * @param options - Standard error options: `cause` is the underlying error, when there is one.
   */
  constructor(failure: GraphSourceFailure, options?: ErrorOptions) {
    super(failure.message, options);
    this.name = "GraphSourceError";
    this.failure = failure;
  }
}
