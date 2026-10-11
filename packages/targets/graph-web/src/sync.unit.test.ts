import {
  createFakeGraphSource,
  createGraphSourceRouter,
  GraphSourceError,
  type GraphSourcePager,
} from "@exadev/process-graph-source-contract";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import { describe, expect, test } from "vitest";
import { failureOf } from "./failure.ts";
import { runSync, UnknownSourceError, type SyncProgress } from "./sync.ts";
import { apiPage, fakeScopes, pageOf } from "./test-support/ports.ts";

const newStore = () =>
  createRouterClient(createGraphStoreRouter(createFakeGraphStore()));

const fakeGitHub = createFakeGraphSource({
  source: "github",
  scopes: fakeScopes,
});

const lookup = (pager: GraphSourcePager) => (prefix: string) =>
  prefix === "github"
    ? createRouterClient(createGraphSourceRouter(pager))
    : undefined;

const modelId = "github:acme";

describe("runSync", () => {
  test("writes every page as it is read, reports progress after each, and ends with no checkpoint", async () => {
    const store = newStore();
    const progress: SyncProgress[] = [];

    const result = await runSync({
      store,
      sources: lookup(fakeGitHub),
      modelId,
      scopes: ["github:acme"],
      signal: new AbortController().signal,
      onProgress: (step) => {
        progress.push(step);
      },
    });

    expect(
      progress.map((step) => [step.pages, step.checkpoint?.after]),
    ).toEqual([
      [1, "github%3Aacme@0"],
      [2, undefined],
    ]);
    expect(result).toEqual({
      pages: 2,
      activities: 5,
      transitions: 4,
      gaps: [],
      checkpoint: undefined,
    });
    const stored = await store.v1.models.load({ modelId });
    expect(
      stored.model.elements.map((element) => element.id).toSorted(),
    ).toEqual([
      "github:acme/api#1",
      "github:acme/api#2",
      "github:acme/web#1",
      "github:acme/web#2",
      "github:partner/sdk#1",
    ]);
    expect(stored.overlay).toMatchObject({
      "github:acme/api#1": "done",
      "github:acme/web#2": "open",
    });
  });

  test("resumes from a checkpoint with only the pages after it", async () => {
    const store = newStore();
    const read: string[] = [];
    const counting: GraphSourcePager = {
      source: "github",
      page: async (request) => {
        read.push(request.cursor ?? "start");

        return fakeGitHub.page(request);
      },
    };
    await store.v1.items.upsert({
      modelId,
      items: {
        participants: apiPage.participants,
        activities: apiPage.activities,
        transitions: apiPage.transitions,
        overlay: apiPage.overlay,
      },
    });

    const result = await runSync({
      store,
      sources: lookup(counting),
      modelId,
      scopes: ["github:acme"],
      resume: {
        modelId,
        scopes: ["github:acme"],
        source: "github",
        after: "github%3Aacme@0",
      },
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(read).toEqual(["github%3Aacme@0"]);
    expect(result.pages).toBe(1);
    const stored = await store.v1.models.load({ modelId });
    expect(
      stored.model.transitions.map((transition) => transition.id),
    ).toContain("github:acme/api#1->github:acme/api#2");
  });

  test("holds a transition back until the page that brings its other end", async () => {
    const store = newStore();
    const early = pageOf([
      {
        id: "github:acme/web#1",
        label: "Build the page",
        repository: "github:acme/web",
        state: "open",
        blockedBy: ["github:acme/api#2"],
      },
    ]);
    const late = pageOf([
      {
        id: "github:acme/api#2",
        label: "Build the endpoint",
        repository: "github:acme/api",
        state: "open",
        blockedBy: [],
      },
    ]);
    const progress: SyncProgress[] = [];

    await runSync({
      store,
      sources: lookup(
        createFakeGraphSource({
          source: "github",
          scopes: { "github:acme": [early, late] },
        }),
      ),
      modelId,
      scopes: ["github:acme"],
      signal: new AbortController().signal,
      onProgress: (step) => {
        progress.push(step);
      },
    });

    expect(progress.map((step) => step.transitions)).toEqual([0, 1]);
    const stored = await store.v1.models.load({ modelId });
    expect(stored.model.transitions).toEqual([
      {
        id: "github:acme/api#2->github:acme/web#1",
        source: "github:acme/api#2",
        target: "github:acme/web#1",
      },
    ]);
  });

  test("keeps the pages before a failure, reports where to resume, and passes the failure on", async () => {
    const store = newStore();
    const progress: SyncProgress[] = [];
    const limited: GraphSourcePager = {
      source: "github",
      page: async (request) => {
        if (request.cursor !== undefined) {
          throw new GraphSourceError({
            kind: "rate-limited",
            message: "rate limited",
            resetAt: "2100-01-01T00:00:00.000Z",
          });
        }

        return fakeGitHub.page(request);
      },
    };

    const failure = await runSync({
      store,
      sources: lookup(limited),
      modelId,
      scopes: ["github:acme"],
      signal: new AbortController().signal,
      onProgress: (step) => {
        progress.push(step);
      },
    }).catch((error: unknown) => failureOf(error));

    expect(failure).toEqual({
      kind: "rate-limited",
      message: "rate limited",
      resetAt: "2100-01-01T00:00:00.000Z",
    });
    expect(progress.at(-1)?.checkpoint).toEqual({
      modelId,
      scopes: ["github:acme"],
      source: "github",
      after: "github%3Aacme@0",
    });
    const stored = await store.v1.models.load({ modelId });
    expect(stored.model.elements.map((element) => element.id)).toEqual([
      "github:acme/api#1",
      "github:acme/api#2",
    ]);
  });

  test("reports the parts of the scope the source could not read", async () => {
    const result = await runSync({
      store: newStore(),
      sources: lookup(fakeGitHub),
      modelId: "github:acme github:ghost",
      scopes: ["github:acme", "github:ghost"],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.gaps).toEqual([
      {
        target: "github:ghost",
        reason: "not-found",
        message: "github:ghost does not exist",
      },
    ]);
  });

  test("stops when its signal is aborted, keeping what it wrote", async () => {
    const store = newStore();
    const controller = new AbortController();

    const outcome = runSync({
      store,
      sources: lookup(fakeGitHub),
      modelId,
      scopes: ["github:acme"],
      signal: controller.signal,
      onProgress: () => {
        controller.abort();
      },
    });

    await expect(outcome).rejects.toThrow();
    const stored = await store.v1.models.load({ modelId });
    expect(stored.model.elements).toHaveLength(2);
  });

  test("refuses a scope whose source the app cannot read", async () => {
    await expect(
      runSync({
        store: newStore(),
        sources: lookup(fakeGitHub),
        modelId: "linear:team",
        scopes: ["linear:team"],
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(UnknownSourceError);
  });
});
