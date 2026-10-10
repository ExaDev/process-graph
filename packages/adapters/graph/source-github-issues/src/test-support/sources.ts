import {
  createGraphSourceRouter,
  type GraphSourceRouter,
} from "@exadev/process-graph-source-contract";
import type { GraphqlFetch } from "../graphql.ts";
import { createGitHubIssuesSource } from "../source.ts";
import { loadRecording, replayFetch } from "./replay.ts";
import { fixturePageSize } from "./scopes.ts";

/** A made-up token: the replayed responses never check it, and a test can assert it never leaks into an error. */
export const fakeToken = "test-token-not-a-credential";

/** A fixed clock for rate-limit resets. */
export const fixedNow = Date.parse("2026-10-10T12:00:00Z");

/**
 * The adapter over the recorded fixture, at the page size it was recorded with.
 * @returns The router, and the requests the replay has answered.
 */
export const recordedRouter = (): {
  readonly router: GraphSourceRouter;
  readonly requests: readonly string[];
} => {
  const replay = replayFetch(loadRecording("github"));
  const router = createGraphSourceRouter(
    createGitHubIssuesSource({
      token: async () => Promise.resolve(fakeToken),
      fetch: replay.fetch,
      now: () => fixedNow,
      pageSize: fixturePageSize,
    }),
  );

  return { router, requests: replay.requests };
};

/**
 * The adapter over a fetch the test writes, for responses no recording can produce, such as rate limiting.
 * @param fetch - Answers every request.
 * @returns The router.
 */
export const stubbedRouter = (fetch: GraphqlFetch): GraphSourceRouter =>
  createGraphSourceRouter(
    createGitHubIssuesSource({
      token: async () => Promise.resolve(fakeToken),
      fetch,
      now: () => fixedNow,
      pageSize: fixturePageSize,
    }),
  );
