import { describe, expect, test } from "vitest";
import { graphSourceConformance } from "./conformance.ts";
import { createFakeGraphSource } from "./fake.ts";
import { createGraphSourceRouter } from "./router.ts";
import { fakeOptions } from "./test-support/pages.ts";
import { inProcessClient, messagePortClient } from "./conformance.ts";

const router = createGraphSourceRouter(createFakeGraphSource(fakeOptions));
const scope = ["fake:acme/alpha", "fake:acme/beta"];

const listing = {
  roots: true,
  parent: "fake:acme",
  missingParent: "fake:umbrella",
  malformedParent: "other:acme",
};

graphSourceConformance({
  name: "in-memory fake, in process",
  createClient: () => inProcessClient(router),
  scope,
  missingScope: "fake:acme/gamma",
  malformedScope: "other:acme/alpha",
  listing,
});

graphSourceConformance({
  name: "in-memory fake, over a message port",
  createClient: () => messagePortClient(router),
  scope,
  missingScope: "fake:acme/gamma",
  malformedScope: "fake:",
  listing: { ...listing, malformedParent: "fake:" },
});

describe("createFakeGraphSource", () => {
  test("serves the scopes in the order requested, one page per call", async () => {
    const client = inProcessClient(router);
    const first = await client.v1.sync.page({
      scope: ["fake:acme/beta", "fake:acme/alpha"],
    });
    expect(first.activities.map((activity) => activity.id)).toEqual([
      "fake:acme/beta#1",
      "fake:acme/alpha#2",
    ]);
    expect(first.next).toBe("fake%3Aacme%2Fbeta@0");
  });

  test("a repeated scope identifier is read once", async () => {
    const client = inProcessClient(router);
    const only = await client.v1.sync.page({
      scope: ["fake:acme/beta", "fake:acme/beta"],
    });
    expect(only.next).toBeUndefined();
  });

  test("a known scope with no pages answers with one empty page", async () => {
    const client = inProcessClient(
      createGraphSourceRouter(
        createFakeGraphSource({ source: "fake", scopes: { "fake:empty": [] } }),
      ),
    );
    await expect(
      client.v1.sync.page({ scope: ["fake:empty"] }),
    ).resolves.toEqual({
      participants: [],
      activities: [],
      transitions: [],
      relations: [],
      overlay: {},
      gaps: [],
    });
  });

  test("the last page's position is not a cursor it accepts", async () => {
    const client = inProcessClient(router);
    await expect(
      client.v1.sync.page({
        scope: ["fake:acme/beta"],
        after: "fake%3Aacme%2Fbeta@0",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor", value: "fake%3Aacme%2Fbeta@0" },
    });
  });

  test("a states filter keeps the activities in those states and drops what they were part of", async () => {
    const page = await inProcessClient(router).v1.sync.page({
      scope: ["fake:acme/alpha"],
      filter: { states: ["open"] },
    });
    expect(page.activities.map((activity) => activity.id)).toEqual([
      "fake:acme/alpha#2",
    ]);
    expect(page.transitions).toEqual([]);
    expect(page.relations).toEqual([
      { kind: "part-of", from: "fake:acme/alpha", to: "fake:acme" },
    ]);
    expect(page.overlay).toEqual({ "fake:acme/alpha#2": "open" });
    expect(page.next).toBe(
      `fake%3Aacme%2Falpha@0;${encodeURIComponent('[["open"],null,null]')}`,
    );
  });

  test("a labels filter keeps nothing, since the fake's activities carry no labels", async () => {
    const page = await inProcessClient(router).v1.sync.page({
      scope: ["fake:acme/beta"],
      filter: { labels: ["bug"] },
    });
    expect(page.activities).toEqual([]);
    expect(page.transitions).toEqual([]);
  });

  test("a filtered cursor resumes only under the same filter", async () => {
    const client = inProcessClient(router);
    const filter = { states: ["open", "done"] } as const;
    const first = await client.v1.sync.page({ scope, filter });
    const second = await client.v1.sync.page({
      scope,
      filter,
      after: first.next ?? "",
    });
    expect(second.activities.map((activity) => activity.id)).toEqual([
      "fake:acme/alpha#3",
    ]);
    await expect(
      client.v1.sync.page({ scope, after: first.next ?? "" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor" },
    });
  });

  test("lists the top-level scopes and an organisation's children a page at a time", async () => {
    const client = inProcessClient(router);
    await expect(client.v1.scopes.roots({})).resolves.toEqual({
      entries: [{ scope: "fake:acme", label: "Acme", archived: false }],
      gaps: [],
      next: "roots@1",
    });
    const first = await client.v1.scopes.children({ scope: "fake:acme" });
    expect(first).toEqual({
      entries: [
        {
          scope: "fake:acme/alpha",
          label: "alpha",
          description: "The store",
          url: "https://example.com/acme/alpha",
          archived: false,
        },
      ],
      gaps: [],
      next: "fake%3Aacme@1",
    });
    await expect(
      client.v1.scopes.children({ scope: "fake:acme", after: "fake%3Aacme@2" }),
    ).resolves.toEqual({
      entries: [{ scope: "fake:acme/legacy", label: "legacy", archived: true }],
      gaps: [],
    });
  });

  test("a known scope with nothing inside lists an empty page, and a cursor past the end is refused", async () => {
    const client = inProcessClient(router);
    await expect(
      client.v1.scopes.children({ scope: "fake:acme/beta" }),
    ).resolves.toEqual({ entries: [], gaps: [] });
    await expect(
      client.v1.scopes.children({ scope: "fake:acme", after: "fake%3Aacme@3" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor", value: "fake%3Aacme@3" },
    });
  });

  test("without a page size a listing is one page", async () => {
    const client = inProcessClient(
      createGraphSourceRouter(
        createFakeGraphSource({ ...fakeOptions, listingPageSize: undefined }),
      ),
    );
    await expect(
      client.v1.scopes.children({ scope: "fake:acme" }),
    ).resolves.not.toHaveProperty("next");
  });

  test("a listing page size that is not a positive integer is refused", () => {
    expect(() =>
      createFakeGraphSource({ ...fakeOptions, listingPageSize: 0 }),
    ).toThrow(RangeError);
  });

  test("describe names the source", async () => {
    await expect(inProcessClient(router).v1.describe()).resolves.toEqual({
      source: "fake",
    });
  });
});
