import { isDefinedError } from "@orpc/client";
import { describe, expect, test } from "vitest";
import { GraphSourceError, type GraphSourceFailure } from "./errors.ts";
import { createFakeGraphSource } from "./fake.ts";
import {
  createGraphSourceRouter,
  type GraphSourcePager,
  type PageRequest,
} from "./router.ts";
import { fakeOptions } from "./test-support/pages.ts";
import { inProcessClient, messagePortClient } from "./conformance.ts";

const scope = ["fake:acme/alpha", "fake:acme/beta"];
const fake = createFakeGraphSource(fakeOptions);

/** A pager that serves the fake's first page, then fails every later call with `failure`. */
const failingAfterFirstPage = (
  failure: GraphSourceFailure,
): GraphSourcePager => ({
  source: "fake",
  page: async (request) => {
    if (request.cursor !== undefined) {
      throw new GraphSourceError(failure);
    }

    return fake.page(request);
  },
});

const failures: readonly (readonly [GraphSourceFailure, object])[] = [
  [
    { kind: "unauthorised", message: "bad credentials" },
    { code: "UNAUTHORIZED", message: "bad credentials", data: {} },
  ],
  [
    {
      kind: "rate-limited",
      message: "slow down",
      resetAt: "2026-10-10T12:00:00.000Z",
    },
    {
      code: "TOO_MANY_REQUESTS",
      message: "slow down",
      data: { resetAt: "2026-10-10T12:00:00.000Z" },
    },
  ],
  [
    { kind: "rate-limited", message: "slow down", resetAt: undefined },
    { code: "TOO_MANY_REQUESTS", message: "slow down", data: {} },
  ],
  [
    { kind: "bad-request", message: "no", reason: "invalid-scope", value: "x" },
    {
      code: "BAD_REQUEST",
      message: "no",
      data: { reason: "invalid-scope", value: "x" },
    },
  ],
];

describe.each([
  ["in process", inProcessClient],
  ["over a message port", messagePortClient],
])("createGraphSourceRouter, %s", (_, clientFor) => {
  test.each(failures)(
    "maps %o to its typed error on page",
    async (failure, expected) => {
      const client = clientFor(
        createGraphSourceRouter(failingAfterFirstPage(failure)),
      );
      const first = await client.v1.sync.page({ scope });
      await expect(
        client.v1.sync.page({ scope, after: first.next ?? "" }),
      ).rejects.toMatchObject({
        ...expected,
        defined: true,
      });
    },
  );

  test.each(failures)(
    "ends a stream with %o after the pages already yielded",
    async (failure, expected) => {
      const client = clientFor(
        createGraphSourceRouter(failingAfterFirstPage(failure)),
      );
      const iterator = await client.v1.sync.stream({ scope });
      const first = await iterator.next();
      expect(first.done).toBe(false);
      await expect(iterator.next()).rejects.toMatchObject({
        ...expected,
        defined: true,
      });
    },
  );

  test("an error that is not a GraphSourceError is not reported as a defined contract error", async () => {
    const client = clientFor(
      createGraphSourceRouter({
        source: "fake",
        page: async () => Promise.reject(new Error("boom")),
      }),
    );
    await expect(client.v1.sync.page({ scope })).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && !isDefinedError(error),
    );
  });
});

describe("the scope listing", () => {
  test("a pager without one answers NOT_IMPLEMENTED", async () => {
    const client = inProcessClient(
      createGraphSourceRouter({ source: "fake", page: fake.page }),
    );
    const notImplemented = {
      code: "NOT_IMPLEMENTED",
      defined: true,
      data: {},
    };
    await expect(client.v1.scopes.roots({})).rejects.toMatchObject(
      notImplemented,
    );
    await expect(
      client.v1.scopes.children({ scope: "fake:acme" }),
    ).rejects.toMatchObject(notImplemented);
  });

  test("passes the filter to the pager", async () => {
    const seen: PageRequest["filter"][] = [];
    const recording: GraphSourcePager = {
      source: "fake",
      page: async (request: PageRequest) => {
        seen.push(request.filter);

        return await fake.page(request);
      },
    };
    const client = inProcessClient(createGraphSourceRouter(recording));
    const filter = { labels: ["bug"] };
    await client.v1.sync.page({ scope, filter });
    for await (const page of await client.v1.sync.stream({ scope, filter })) {
      expect(page.activities).toEqual([]);
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((received) => received?.labels?.[0] === "bug")).toBe(
      true,
    );
  });
});

describe("the abort signal", () => {
  test("reaches the pager, and aborting it mid-stream ends the stream", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const recording: GraphSourcePager = {
      source: "fake",
      page: async (request: PageRequest) => {
        seen.push(request.signal);

        return await fake.page(request);
      },
    };
    const client = inProcessClient(createGraphSourceRouter(recording));
    const controller = new AbortController();
    const iterator = await client.v1.sync.stream(
      { scope },
      { signal: controller.signal },
    );
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toThrow();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((signal) => signal?.aborted === true)).toBe(true);
  });
});
