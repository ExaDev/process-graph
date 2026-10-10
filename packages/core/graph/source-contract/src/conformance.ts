import { validate, validateOverlay } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { assembleSync } from "./assemble.ts";
import type { GraphSourceClient } from "./contract.ts";
import { paginate } from "./paginate.ts";
import type { SyncPage } from "./schema.ts";

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
}

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

/** Reads every page by following `next` through `sync.page`. */
const walkPages = async (
  client: GraphSourceClient,
  scope: readonly string[],
): Promise<readonly SyncPage[]> => {
  const pages: SyncPage[] = [];
  const seen = new Set<string>();
  const paged = paginate(undefined, async (after) =>
    client.v1.sync.page(after === undefined ? { scope } : { scope, after }),
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
  input: { readonly scope: readonly string[]; readonly after?: string },
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
const nextOf = (page: SyncPage | undefined): string => {
  if (page?.next === undefined) {
    throw new Error("expected a page that is not the last");
  }

  return page.next;
};

const identifiersOf = (pages: readonly SyncPage[]): readonly string[] =>
  pages.flatMap((page) => [
    ...page.participants.map((participant) => participant.id),
    ...page.activities.map((activity) => activity.id),
    ...page.transitions.map((transition) => transition.id),
  ]);

/**
 * The behaviour every `GraphSource` must have, as Vitest tests run against a client. An adapter's own test calls this once per transport it supports; because the tests talk only to the oRPC client, the same assertions hold in process, over a message port or over HTTP.
 *
 * The tests check that paging and streaming return the same pages; that a stream closed after any page resumes from that page's `next` with exactly the pages that follow; that a sync is deterministic; that the assembled model and overlay are valid and every identifier carries the source's prefix; that relations name what the sync returned; that an unknown scope is a gap beside the rest; that malformed scopes and foreign cursors are typed `BAD_REQUEST` errors; and that an aborted signal ends both procedures.
 * @param options - The client factory and the scopes to exercise.
 */
export const graphSourceConformance = (
  options: GraphSourceConformanceOptions,
): void => {
  const { name, createClient, scope, missingScope, malformedScope } = options;

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
};
