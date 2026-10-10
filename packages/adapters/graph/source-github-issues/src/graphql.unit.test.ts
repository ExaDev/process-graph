import { inProcessClient } from "@exadev/process-graph-source-contract/conformance";
import { describe, expect, test } from "vitest";
import type { GraphqlFetch } from "./graphql.ts";
import { fakeToken, fixedNow, stubbedRouter } from "./test-support/sources.ts";

const scope = ["github:ExaDev/document-schema.js"];

const ok = 200;
const forbidden = 403;
const tooManyRequests = 429;
const badGateway = 502;
const millisecondsPerSecond = 1000;
const retryAfterSeconds = 60;

/** A fetch that answers every request with one response the test writes. */
const answering =
  (
    status: number,
    body: unknown,
    headers: Readonly<Record<string, string>> = {},
  ): GraphqlFetch =>
  async () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers }));

const pageWith = async (fetch: GraphqlFetch) =>
  inProcessClient(stubbedRouter(fetch)).v1.sync.page({ scope });

/** An issue as the repository query returns it, with no assignees, blockers or sub-issues unless given. */
const issue = (
  number: number,
  extra: Readonly<Record<string, unknown>> = {},
) => {
  const empty = {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [],
  };

  return {
    number,
    title: `Issue ${String(number)}`,
    state: "OPEN",
    repository: {
      name: "document-schema.js",
      owner: { __typename: "Organization", login: "ExaDev" },
    },
    assignees: empty,
    blockedBy: empty,
    subIssues: empty,
    ...extra,
  };
};

const repositoryWith = (nodes: readonly unknown[]) => ({
  data: {
    repository: {
      name: "document-schema.js",
      owner: { __typename: "Organization", login: "ExaDev" },
      issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
    },
  },
});

describe("rate limiting", () => {
  const resetSeconds = fixedNow / millisecondsPerSecond + retryAfterSeconds;
  const resetAt = new Date(resetSeconds * millisecondsPerSecond).toISOString();

  test.each([
    [
      "HTTP 429 with retry-after",
      answering(
        tooManyRequests,
        { message: "slow down" },
        { "retry-after": String(retryAfterSeconds) },
      ),
    ],
    [
      "HTTP 403 with no requests remaining",
      answering(
        forbidden,
        { message: "API rate limit exceeded" },
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetSeconds),
        },
      ),
    ],
    [
      "a RATE_LIMITED GraphQL error",
      answering(
        ok,
        {
          data: null,
          errors: [
            { type: "RATE_LIMITED", message: "API rate limit exceeded" },
          ],
        },
        {
          "x-ratelimit-reset": String(resetSeconds),
        },
      ),
    ],
    [
      "HTTP 403 naming a secondary rate limit",
      answering(
        forbidden,
        { message: "You have exceeded a secondary rate limit." },
        { "retry-after": String(retryAfterSeconds) },
      ),
    ],
  ])("%s is TOO_MANY_REQUESTS with the reset instant", async (_, fetch) => {
    await expect(pageWith(fetch)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      defined: true,
      data: { resetAt },
    });
  });

  test("a rate limit without a reset instant still says when it is unknown", async () => {
    await expect(
      pageWith(answering(tooManyRequests, { message: "slow down" })),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      data: {},
    });
  });
});

describe("errors", () => {
  test("a FORBIDDEN repository is a forbidden gap", async () => {
    const page = await pageWith(
      answering(ok, {
        data: { repository: null },
        errors: [
          {
            type: "FORBIDDEN",
            message: "Resource protected by organization SAML enforcement.",
          },
        ],
      }),
    );
    expect(page.gaps).toEqual([
      {
        target: scope[0],
        reason: "forbidden",
        message: "Resource protected by organization SAML enforcement.",
      },
    ]);
    expect(page.activities).toEqual([]);
  });

  test("a GraphQL error of another type fails the call rather than being read as a gap", async () => {
    await expect(
      pageWith(
        answering(ok, {
          data: null,
          errors: [{ type: "INTERNAL", message: "boom" }],
        }),
      ),
    ).rejects.toThrow("GitHub GraphQL error INTERNAL: boom");
  });

  test("a response of the wrong shape fails the call", async () => {
    await expect(
      pageWith(answering(ok, { data: { repository: { name: 1 } } })),
    ).rejects.toThrow("GitHub's response does not have the expected shape");
  });

  test("an HTTP error that is not rate limiting fails the call", async () => {
    await expect(
      pageWith(answering(badGateway, { message: "Bad gateway" })),
    ).rejects.toThrow("GitHub answered HTTP 502: Bad gateway");
  });

  test("a body that is not JSON fails the call", async () => {
    await expect(
      pageWith(async () =>
        Promise.resolve(new Response("<html>", { status: ok })),
      ),
    ).rejects.toThrow("GitHub answered HTTP 200 with a body that is not JSON");
  });
});

describe("requests", () => {
  test("send the token as a bearer token to the GraphQL endpoint, with the caller's signal", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const controller = new AbortController();
    await inProcessClient(
      stubbedRouter(async (url, init) => {
        seen.push({ url, init });

        return Promise.resolve(
          new Response(JSON.stringify(repositoryWith([])), { status: ok }),
        );
      }),
    ).v1.sync.page({ scope }, { signal: controller.signal });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.github.com/graphql");
    expect(new Headers(seen[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${fakeToken}`,
    );
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("assignees become role participants related to their issue", async () => {
    const page = await pageWith(
      answering(
        ok,
        repositoryWith([
          issue(1, {
            assignees: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ login: "octocat" }],
            },
          }),
        ]),
      ),
    );
    expect(page.participants).toContainEqual({
      id: "github:@octocat",
      label: "octocat",
      kind: "role",
    });
    expect(page.relations).toContainEqual({
      kind: "assigned-to",
      from: "github:ExaDev/document-schema.js#1",
      to: "github:@octocat",
    });
    expect(page.overlay).toEqual({
      "github:ExaDev/document-schema.js#1": "open",
    });
  });

  test("a node the token cannot see is skipped, and GitHub's error for it is a gap", async () => {
    const page = await pageWith(
      answering(ok, {
        ...repositoryWith([
          issue(1, {
            blockedBy: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [null],
            },
          }),
        ]),
        errors: [
          {
            type: "FORBIDDEN",
            message: "Resource not accessible by integration",
          },
        ],
      }),
    );
    expect(page.transitions).toEqual([]);
    expect(page.gaps).toEqual([
      {
        target: scope[0],
        reason: "forbidden",
        message: "Resource not accessible by integration",
      },
    ]);
  });
});
