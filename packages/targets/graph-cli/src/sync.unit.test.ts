import {
  createFakeGraphSource,
  createGraphSourceRouter,
  GraphSourceError,
  type GraphSourcePager,
} from "@exadev/process-graph-source-contract";
import {
  createGitHubIssuesSource,
  type GraphqlFetch,
} from "@exadev/process-graph-source-github-issues";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, test } from "vitest";
import { exitCodes } from "./exit-codes.ts";
import type { GraphSession } from "./session.ts";
import { sync, SyncInterruptedError, type SourceLookup } from "./sync.ts";
import { githubLikeSource } from "./test-support/fixtures.ts";
import { createHarness, type Harness } from "./test-support/harness.ts";

/** A session over an in-memory store. */
const session = (): GraphSession => ({
  store: createRouterClient(createGraphStoreRouter(createFakeGraphStore())),
  modelId: "default",
  facts: () => ({ found: false }),
  signal: undefined,
});

/** Serves each pager's scopes through the real oRPC router, in process. */
const lookup =
  (...pagers: readonly GraphSourcePager[]): SourceLookup =>
  (prefix) => {
    const pager = pagers.find((candidate) => candidate.source === prefix);

    return pager === undefined
      ? undefined
      : createRouterClient(createGraphSourceRouter(pager));
  };

/** The fixture's GitHub-like source, rate limited after its first page. */
const rateLimitedAfterOnePage = (): {
  readonly pager: GraphSourcePager;
  readonly failure: GraphSourceError;
} => {
  const fake = createFakeGraphSource(githubLikeSource);
  const failure = new GraphSourceError({
    kind: "rate-limited",
    message: "rate limited",
    resetAt: undefined,
  });
  let reads = 0;

  return {
    failure,
    pager: {
      source: fake.source,
      page: async (request) => {
        reads += 1;
        if (reads > 1) {
          throw failure;
        }

        return fake.page(request);
      },
    },
  };
};

/** The GitHub issues adapter with a token port that fails with `original`, and a fetch the sync must never reach. */
const githubWithFailingToken = (original: Error): GraphSourcePager => {
  const unreachable: GraphqlFetch = async () =>
    Promise.reject(new Error("fetch was called without a token"));

  return createGitHubIssuesSource({
    token: async () => Promise.reject(original),
    fetch: unreachable,
    now: () => 0,
  });
};

/** Runs `sync` and returns what it threw. */
const interruption = async (
  sources: SourceLookup,
  scopes: readonly string[],
): Promise<unknown> =>
  sync(session(), sources, { scopes }).then(
    () => {
      throw new Error("the sync did not fail");
    },
    (error: unknown) => error,
  );

describe("a sync a source interrupts, called as a library", () => {
  test("carries where to carry on as data, and only the source's failure as its message", async () => {
    const { pager, failure } = rateLimitedAfterOnePage();
    const jira = createFakeGraphSource({
      source: "jira",
      scopes: { "jira:ACME": [] },
    });

    const error = await interruption(lookup(pager, jira), [
      "github:acme/app",
      "jira:ACME",
      "github:acme/web",
    ]);

    expect(error).toBeInstanceOf(SyncInterruptedError);
    expect(error).toMatchObject({
      exitCode: exitCodes.sourceFailure,
      message: "rate limited",
      resume: {
        scopes: ["github:acme/app", "github:acme/web"],
        after: "github%3Aacme%2Fapp@0",
      },
      remaining: ["jira:ACME"],
      saved: true,
      cause: failure,
    });
  });

  test("reports a token port that fails as a source failure naming the token port, with the port's own error as the cause", async () => {
    const original = new Error("the keychain is locked");

    const error = await interruption(lookup(githubWithFailingToken(original)), [
      "github:acme/app",
    ]);

    expect(error).toBeInstanceOf(SyncInterruptedError);
    expect(error).toMatchObject({
      exitCode: exitCodes.sourceFailure,
      message:
        "the GitHub token port gave no token for acme: the keychain is locked",
      resume: { scopes: ["github:acme/app"] },
      remaining: [],
      saved: false,
    });
    expect(error instanceof Error && error.cause).toBe(original);
    expect(error).not.toHaveProperty(["resume", "after"]);
  });
});

describe("a sync a source interrupts, run as a command", () => {
  let harness: Harness | undefined;

  afterEach(() => {
    harness?.remove();
  });

  test("exits with the source-failure status and prints the command that resumes it", async () => {
    harness = createHarness(
      githubWithFailingToken(new Error("the keychain is locked")),
    );

    expect(await harness.run("sync", "github:acme/app")).toEqual({
      code: exitCodes.sourceFailure,
      stdout: "",
      stderr:
        "the GitHub token port gave no token for acme: the keychain is locked\n" +
        "resume with: sync github:acme/app\n",
    });
  });
});
