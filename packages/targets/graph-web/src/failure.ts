import { InterruptedSyncError } from "@exadev/process-graph-sync";
import { ORPCError } from "@orpc/client";

/**
 * Why a call to a source or the store failed, as the app shows it. The source contract's typed errors arrive as oRPC errors over any transport; anything else is shown by its message.
 *
 * - `unauthorised`: the source rejected the token.
 * - `rate-limited`: the source refuses requests until `resetAt` (an ISO 8601 instant) when it said so.
 * - `bad-request`: a scope or cursor the source does not accept.
 * - `rejected`: the store refused a change that would leave the model invalid.
 * - `other`: anything else.
 */
export type Failure =
  | { readonly kind: "unauthorised"; readonly message: string }
  | {
      readonly kind: "rate-limited";
      readonly message: string;
      readonly resetAt: string | undefined;
    }
  | {
      readonly kind: "bad-request";
      readonly message: string;
      readonly value: string | undefined;
    }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "other"; readonly message: string };

const stringField = (data: unknown, field: string): string | undefined => {
  if (typeof data !== "object" || data === null || !(field in data)) {
    return undefined;
  }
  const value: unknown = Reflect.get(data, field);

  return typeof value === "string" ? value : undefined;
};

/**
 * Classifies what a source or store call threw. A sync a source interrupted is classified by the source's own failure.
 * @param error - The thrown value.
 * @returns The failure to show.
 */
export const failureOf = (error: unknown): Failure => {
  if (error instanceof InterruptedSyncError) {
    return failureOf(error.cause);
  }
  if (error instanceof ORPCError) {
    if (error.code === "UNAUTHORIZED") {
      return { kind: "unauthorised", message: error.message };
    }
    if (error.code === "TOO_MANY_REQUESTS") {
      return {
        kind: "rate-limited",
        message: error.message,
        resetAt: stringField(error.data, "resetAt"),
      };
    }
    if (error.code === "BAD_REQUEST") {
      return {
        kind: "bad-request",
        message: error.message,
        value: stringField(error.data, "value"),
      };
    }
    if (error.code === "UNPROCESSABLE_CONTENT") {
      return { kind: "rejected", message: error.message };
    }
  }

  return {
    kind: "other",
    message: error instanceof Error ? error.message : String(error),
  };
};
