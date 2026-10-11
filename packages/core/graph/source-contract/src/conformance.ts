import { validate, validateOverlay } from "@exadev/process-graph-schema";
import { afterAll, describe, expect, test } from "vitest";
import { assembleSync } from "./assemble.ts";
import type { GraphSourceClient } from "./contract.ts";
import { paginate } from "./paginate.ts";
import type { ScopeListing, SyncFilter, SyncPage } from "./schema.ts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import type { GraphSourceRouter } from "./router.ts";

/** What the conformance kit needs from an adapter's test. */
export interface GraphSourceConformanceOptions {
  /** A name for the `describe` block, such as the adapter and transport under test. */
  readonly name: string;
  /** Makes a client for the source under test. Called once per test, so any transport can be used, in process or over a link. */
  readonly createClient: () => GraphSourceClient;
  /** A scope that exists and spans at least two pages, so resumption is exercised between pages. */
  readonly scope: readonly string[];
  /** A well-formed scope identifier naming nothing, which must arrive as a `not-found` gap. */
  readonly missingScope: string;
  /** A string the source cannot parse as a scope identifier, which must be rejected. */
  readonly malformedScope: string;
  /** What to check of the scope listing, when the source offers one; absent, the listing is not exercised. */
  readonly listing?: ScopeListingConformance;
}

/** The parts of a scope listing the conformance kit exercises. */
export interface ScopeListingConformance {
  /** Whether to exercise `scopes.roots`, which needs credentials whose top-level scopes are readable where the test runs. */
  readonly roots: boolean;
  /** A scope whose children span at least two listing pages, so resumption is exercised between pages. */
  readonly parent: string;
  /** A well-formed scope identifier naming nothing, whose listing must be a `not-found` gap. */
  readonly missingParent: string;
  /** A string the source cannot parse as a scope identifier, which must be rejected. */
  readonly malformedParent: string;
}

/** The filter the kit syncs with: open work, most recently changed first. Every source can express it, and it narrows and reorders what a scope lists. */
const kitFilter: SyncFilter = {
  states: ["open"],
  order: { field: "updated", direction: "descending" },
};

/** A string no source issues as a cursor: it is the kit's own, outside any source's identifier syntax. */
const foreignCursor = "conformance-kit:not-a-cursor";

/** Fails when a page's `next` repeats an earlier one: the sync would never end. */
const recordCursor = (seen: Set<string>, next: string | undefined): void => {
  if (next === undefined) {
    return;
  }
  if (seen.has(next)) {
    throw new Error(`cursor "${next}" repeats, so the sync never ends`);
  }
  seen.add(next);
};

/** Reads every page by following `next` through `sync.page`, under `filter` when one is given. */
const walkPages = async (
  client: GraphSourceClient,
  scope: readonly string[],
  filter?: SyncFilter,
): Promise<readonly SyncPage[]> => {
  const pages: SyncPage[] = [];
  const seen = new Set<string>();
  const paged = paginate(undefined, async (after) =>
    client.v1.sync.page({
      scope,
      ...(after === undefined ? {} : { after }),
      ...(filter === undefined ? {} : { filter }),
    }),
  );
  for await (const page of paged) {
    pages.push(page);
    recordCursor(seen, page.next);
  }

  return pages;
};

/** How much of a stream to read, and with which signal. */
interface StreamOptions {
  /** Stop after this many events, closing the stream early. Absent, the stream is read to its end. */
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** Reads `sync.stream` to its end, or only its first `limit` events, closing the stream early in that case. */
const streamPages = async (
  client: GraphSourceClient,
  input: {
    readonly scope: readonly string[];
    readonly after?: string;
    readonly filter?: SyncFilter;
  },
  { limit, signal }: StreamOptions = {},
): Promise<readonly SyncPage[]> => {
  const pages: SyncPage[] = [];
  const iterator = await client.v1.sync.stream(
    input,
    signal === undefined ? {} : { signal },
  );
  const seen = new Set<string>();
  for await (const page of iterator) {
    pages.push(page);
    recordCursor(seen, page.next);
    if (pages.length === limit) {
      break;
    }
  }

  return pages;
};

/** The cursor to resume after `page`, failing the test when the page is the last. */
const nextOf = (
  page: { readonly next?: string | undefined } | undefined,
): string => {
  if (page?.next === undefined) {
    throw new Error("expected a page that is not the last");
  }

  return page.next;
};

/** One listing request: the top-level scopes, or the children of `parent`. */
type ListingCall = (after: string | undefined) => Promise<ScopeListing>;

const rootsCall =
  (client: GraphSourceClient): ListingCall =>
  async (after) =>
    client.v1.scopes.roots(after === undefined ? {} : { after });

const childrenCall =
  (client: GraphSourceClient, parent: string): ListingCall =>
  async (after) =>
    client.v1.scopes.children(
      after === undefined ? { scope: parent } : { scope: parent, after },
    );

/** Reads every page of a listing by following `next`. */
const walkListing = async (
  call: ListingCall,
): Promise<readonly ScopeListing[]> => {
  const pages: ScopeListing[] = [];
  const seen = new Set<string>();
  for await (const page of paginate(undefined, call)) {
    pages.push(page);
    recordCursor(seen, page.next);
  }

  return pages;
};

/** Checks the paging rules every listing keeps: only the last page lacks `next`, every page resumes from the `next` before it, a second walk returns the same pages, and every entry is a scope of this source. */
const expectListingPages = async (
  client: GraphSourceClient,
  call: ListingCall,
): Promise<readonly ScopeListing[]> => {
  const { source } = await client.v1.describe();
  const pages = await walkListing(call);
  expect(pages.map((page) => page.next === undefined)).toEqual(
    pages.map((_, index) => index === pages.length - 1),
  );
  await Promise.all(
    pages
      .slice(1)
      .map(async (page, index) =>
        expect(call(nextOf(pages[index]))).resolves.toEqual(page),
      ),
  );
  await expect(walkListing(call)).resolves.toEqual(pages);
  for (const entry of pages.flatMap((page) => page.entries)) {
    expect(entry.scope.startsWith(`${source}:`)).toBe(true);
  }

  return pages;
};

const identifiersOf = (pages: readonly SyncPage[]): readonly string[] =>
  pages.flatMap((page) => [
    ...page.participants.map((participant) => participant.id),
    ...page.activities.map((activity) => activity.id),
    ...page.transitions.map((transition) => transition.id),
  ]);

/** The scope listing's share of the kit: paging, resumption, gaps, typed errors and aborts, and entries that sync. */
const scopeListingConformance = (
  name: string,
  createClient: () => GraphSourceClient,
  { roots, parent, missingParent, malformedParent }: ScopeListingConformance,
): void => {
  describe(`GraphSource scope listing conformance: ${name}`, () => {
    test("an owner's children span at least two pages, resume from every next, and are deterministic", async () => {
      const client = createClient();
      const pages = await expectListingPages(
        client,
        childrenCall(client, parent),
      );
      expect(pages.length).toBeGreaterThanOrEqual(2);
      expect(pages.flatMap((page) => page.gaps)).toEqual([]);
    });

    test("a listed child is a scope that syncs", async () => {
      const client = createClient();
      const [first] = await walkListing(childrenCall(client, parent));
      const [entry] = first?.entries ?? [];
      if (entry === undefined) {
        throw new Error(`expected ${parent} to list a child`);
      }
      await expect(
        client.v1.sync.page({ scope: [entry.scope] }),
      ).resolves.toMatchObject({ gaps: [] });
    });

    test.skipIf(!roots)(
      "the top-level scopes resume from every next and are deterministic",
      async () => {
        const client = createClient();
        const pages = await expectListingPages(client, rootsCall(client));
        expect(pages.flatMap((page) => page.entries).length).toBeGreaterThan(0);
      },
    );

    test("the children of an unknown scope are a not-found gap on an empty page", async () => {
      const client = createClient();
      await expect(
        client.v1.scopes.children({ scope: missingParent }),
      ).resolves.toEqual({
        entries: [],
        gaps: [
          expect.objectContaining({
            target: missingParent,
            reason: "not-found",
          }),
        ],
      });
    });

    test("a malformed parent is a BAD_REQUEST with reason invalid-scope", async () => {
      await expect(
        createClient().v1.scopes.children({ scope: malformedParent }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "invalid-scope", value: malformedParent },
      });
    });

    test("a cursor the listing did not issue is a BAD_REQUEST with reason invalid-cursor", async () => {
      const client = createClient();
      const rejection = {
        code: "BAD_REQUEST",
        data: { reason: "invalid-cursor", value: foreignCursor },
      };
      await expect(
        client.v1.scopes.children({ scope: parent, after: foreignCursor }),
      ).rejects.toMatchObject(rejection);
      await expect(
        client.v1.scopes.roots({ after: foreignCursor }),
      ).rejects.toMatchObject(rejection);
    });

    test("a cursor for one parent is refused for another", async () => {
      const client = createClient();
      const first = await client.v1.scopes.children({ scope: parent });
      const after = nextOf(first);
      await expect(
        client.v1.scopes.children({ scope: missingParent, after }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "invalid-cursor", value: after },
      });
    });

    test("an aborted signal ends both listings", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      const { signal } = controller;
      await expect(
        client.v1.scopes.children({ scope: parent }, { signal }),
      ).rejects.toThrow();
      await expect(client.v1.scopes.roots({}, { signal })).rejects.toThrow();
    });
  });
};

/**
 * The behaviour every `GraphSource` must have, as Vitest tests run against a client. An adapter's own test calls this once per transport it supports; because the tests talk only to the oRPC client, the same assertions hold in process, over a message port or over HTTP.
 *
 * The tests check that paging and streaming return the same pages; that a stream closed after any page resumes from that page's `next` with exactly the pages that follow; that a sync is deterministic; that the assembled model and overlay are valid and every identifier carries the source's prefix; that relations name what the sync returned; that an unknown scope is a gap beside the rest; that malformed scopes and foreign cursors are typed `BAD_REQUEST` errors; that a filtered sync pages consistently, reads nothing the unfiltered one does not, and refuses a cursor issued under another filter; and that an aborted signal ends both procedures. With `listing`, they also check the scope listing: paging and resumption, gaps for an unknown parent, typed errors, aborts, and that a listed child syncs.
 * @param options - The client factory and the scopes to exercise.
 */
export const graphSourceConformance = (
  options: GraphSourceConformanceOptions,
): void => {
  const { name, createClient, scope, missingScope, malformedScope, listing } =
    options;

  describe(`GraphSource conformance: ${name}`, () => {
    test("the scope spans at least two pages, so resumption is exercised", async () => {
      const pages = await walkPages(createClient(), scope);
      expect(pages.length).toBeGreaterThanOrEqual(2);
    });

    test("every page but the last carries next, and the last does not", async () => {
      const pages = await walkPages(createClient(), scope);
      expect(pages.map((page) => page.next === undefined)).toEqual(
        pages.map((_, index) => index === pages.length - 1),
      );
    });

    test("the stream yields exactly the pages paging returns", async () => {
      const client = createClient();
      const paged = await walkPages(client, scope);
      await expect(streamPages(client, { scope })).resolves.toEqual(paged);
    });

    test("a stream closed after any page resumes from its next with exactly the pages that follow", async () => {
      const client = createClient();
      const all = await streamPages(client, { scope });
      // Each interruption point is independent of the others, so they are checked together.
      const interruptionPoints = all.slice(1).map((_, index) => index + 1);
      await Promise.all(
        interruptionPoints.map(async (taken) => {
          const interrupted = await streamPages(
            client,
            { scope },
            { limit: taken },
          );
          expect(interrupted).toEqual(all.slice(0, taken));
          const resumeFrom = nextOf(interrupted.at(-1));
          await expect(
            streamPages(client, { scope, after: resumeFrom }),
          ).resolves.toEqual(all.slice(taken));
          await expect(
            client.v1.sync.page({ scope, after: resumeFrom }),
          ).resolves.toEqual(all[taken]);
        }),
      );
    });

    test("two syncs of the same scope return the same pages", async () => {
      const client = createClient();
      const first = await walkPages(client, scope);
      await expect(walkPages(client, scope)).resolves.toEqual(first);
    });

    test("every identifier carries the source prefix, and the assembled model and overlay are valid", async () => {
      const client = createClient();
      const { source } = await client.v1.describe();
      const pages = await walkPages(client, scope);
      for (const id of identifiersOf(pages)) {
        expect(id.startsWith(`${source}:`)).toBe(true);
      }
      const { model, overlay, relations } = assembleSync(pages);
      expect(model.elements.length).toBeGreaterThan(0);
      expect(validate(model)).toEqual([]);
      expect(validateOverlay(model, overlay)).toEqual([]);
      const known = new Set([
        ...model.participants.map((participant) => participant.id),
        ...model.elements.map((element) => element.id),
      ]);
      for (const relation of relations) {
        expect(known).toContain(relation.from);
        expect(known).toContain(relation.to);
      }
    });

    test("an unknown scope is a not-found gap, and the rest of the sync still arrives", async () => {
      const client = createClient();
      const expected = assembleSync(await walkPages(client, scope));
      const withMissing = assembleSync(
        await walkPages(client, [missingScope, ...scope]),
      );
      expect(withMissing.gaps).toContainEqual(
        expect.objectContaining({ target: missingScope, reason: "not-found" }),
      );
      expect(withMissing.model).toEqual(expected.model);
      expect(withMissing.overlay).toEqual(expected.overlay);
    });

    test("a malformed scope identifier is a BAD_REQUEST with reason invalid-scope", async () => {
      const client = createClient();
      const rejection = {
        code: "BAD_REQUEST",
        data: { reason: "invalid-scope", value: malformedScope },
      };
      await expect(
        client.v1.sync.page({ scope: [malformedScope] }),
      ).rejects.toMatchObject(rejection);
      await expect(
        streamPages(client, { scope: [malformedScope] }),
      ).rejects.toMatchObject(rejection);
    });

    test("a cursor the source did not issue is a BAD_REQUEST with reason invalid-cursor", async () => {
      const client = createClient();
      const rejection = {
        code: "BAD_REQUEST",
        data: { reason: "invalid-cursor", value: foreignCursor },
      };
      await expect(
        client.v1.sync.page({ scope, after: foreignCursor }),
      ).rejects.toMatchObject(rejection);
      await expect(
        streamPages(client, { scope, after: foreignCursor }),
      ).rejects.toMatchObject(rejection);
    });

    test("a filtered sync pages and streams the same pages, with cursors that never repeat", async () => {
      const client = createClient();
      const paged = await walkPages(client, scope, kitFilter);
      await expect(
        streamPages(client, { scope, filter: kitFilter }),
      ).resolves.toEqual(paged);
      await expect(walkPages(client, scope, kitFilter)).resolves.toEqual(paged);
    });

    test("a filtered sync reads nothing the unfiltered sync does not", async () => {
      const client = createClient();
      const all = assembleSync(await walkPages(client, scope));
      const narrowed = assembleSync(await walkPages(client, scope, kitFilter));
      const everyActivity = new Set(all.model.elements.map(({ id }) => id));
      for (const element of narrowed.model.elements) {
        expect(everyActivity).toContain(element.id);
      }
    });

    test("a cursor is refused under a filter other than the one it was issued for", async () => {
      const client = createClient();
      const first = await client.v1.sync.page({ scope });
      const after = nextOf(first);
      await expect(
        client.v1.sync.page({ scope, after, filter: kitFilter }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "invalid-cursor", value: after },
      });
    });

    test("an aborted signal ends both procedures", async () => {
      const client = createClient();
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.v1.sync.page({ scope }, { signal: controller.signal }),
      ).rejects.toThrow();
      await expect(
        streamPages(client, { scope }, { signal: controller.signal }),
      ).rejects.toThrow();
    });
  });

  if (listing !== undefined) {
    scopeListingConformance(name, createClient, listing);
  }
};

/**
 * A client that calls the router in the same process, with no serialisation.
 * @param router - The router to call.
 * @returns The client.
 */
export const inProcessClient = (router: GraphSourceRouter): GraphSourceClient =>
  createRouterClient(router);

/**
 * A client that reaches the router across a `MessageChannel`, serialising every call and event as a worker transport does. Each client gets its own channel, closed after the calling test file's tests, so call it from within a test file.
 * @param router - The router to serve on the channel.
 * @returns The client.
 */
export const messagePortClient = (
  router: GraphSourceRouter,
): GraphSourceClient => {
  const { port1, port2 } = new MessageChannel();
  new RPCHandler(router).upgrade(port1);
  port2.start();
  afterAll(() => {
    port1.close();
    port2.close();
  });

  return createORPCClient<GraphSourceClient>(new RPCLink({ port: port2 }));
};
