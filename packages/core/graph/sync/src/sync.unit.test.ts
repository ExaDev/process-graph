import {
  createFakeGraphSource,
  GraphSourceError,
  type GraphSourcePager,
  type SyncFilter,
} from "@exadev/process-graph-source-contract";
import { describe, expect, test } from "vitest";
import { InvalidScopeError, scopesBySource } from "./scopes.ts";
import { syncScopes, UnknownSourceError, type SyncProgress } from "./sync.ts";
import {
  apiPage,
  fakeScopes,
  lookup,
  newStore,
  pageOf,
} from "./test-support/fixtures.ts";

const fakeGitHub = createFakeGraphSource({
  source: "github",
  scopes: fakeScopes,
});

const modelId = "github:acme";

describe("syncScopes", () => {
  test("writes every page as it is read, reports progress after each, and ends with no checkpoint", async () => {
    const store = newStore();
    const progress: SyncProgress[] = [];

    const result = await syncScopes({
      store,
      sources: lookup(fakeGitHub),
      modelId,
      scopes: ["github:acme"],
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
      revision: progress.at(-1)?.revision,
      participants: 4,
      activities: 4,
      transitions: 2,
      relations: 5,
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
      "github:acme/web#9",
    ]);
    expect(stored.overlay).toMatchObject({
      "github:acme/api#1": "done",
      "github:acme/web#9": "open",
    });
  });

  test("keeps the relations a source reports, so the store answers hierarchy queries", async () => {
    const store = newStore();

    await syncScopes({
      store,
      sources: lookup(fakeGitHub),
      modelId,
      scopes: ["github:acme"],
    });

    const { relations } = await store.v1.relations.list({ modelId });
    expect(relations).toEqual([
      { kind: "part-of", from: "github:acme/api", to: "github:@acme" },
      { kind: "assigned-to", from: "github:acme/api#1", to: "github:@alice" },
      { kind: "child-of", from: "github:acme/api#2", to: "github:acme/web#9" },
      { kind: "part-of", from: "github:acme/web", to: "github:@acme" },
      { kind: "child-of", from: "github:acme/web#1", to: "github:acme/web#9" },
    ]);
    expect(
      await store.v1.query.children({ modelId, element: "github:acme/web#9" }),
    ).toEqual({ children: ["github:acme/api#2", "github:acme/web#1"] });
    expect(
      await store.v1.query.ancestors({ modelId, element: "github:acme/api#2" }),
    ).toEqual({
      ancestors: [{ element: "github:acme/web#9", distance: 1 }],
    });
  });

  test("holds a transition and a relation back until the page that brings their other end", async () => {
    const store = newStore();
    const early = pageOf([
      {
        id: "github:acme/web#1",
        label: "Build the page",
        repository: "github:acme/web",
        state: "open",
        blockedBy: ["github:acme/api#2"],
        parent: "github:acme/api#2",
      },
    ]);
    const late = pageOf([
      {
        id: "github:acme/api#2",
        label: "Build the endpoint",
        repository: "github:acme/api",
        state: "open",
      },
    ]);
    const progress: SyncProgress[] = [];

    await syncScopes({
      store,
      sources: lookup(
        createFakeGraphSource({
          source: "github",
          scopes: { "github:acme": [early, late] },
        }),
      ),
      modelId,
      scopes: ["github:acme"],
      onProgress: (step) => {
        progress.push(step);
      },
    });

    expect(progress.map((step) => step.transitions)).toEqual([0, 1]);
    // The first page's own repository membership is written at once; its sub-issue waits for the parent the second page brings.
    expect(progress.map((step) => step.relations)).toEqual([
      early.relations.length - 1,
      early.relations.length + late.relations.length,
    ]);
    const stored = await store.v1.models.load({ modelId });
    expect(stored.model.transitions).toEqual([
      {
        id: "github:acme/api#2->github:acme/web#1",
        source: "github:acme/api#2",
        target: "github:acme/web#1",
      },
    ]);
    expect(
      await store.v1.query.children({ modelId, element: "github:acme/api#2" }),
    ).toEqual({ children: ["github:acme/web#1"] });
  });

  test("writes a relation whose end never arrives with the last page, where the store names the missing reference", async () => {
    const orphan = pageOf([
      {
        id: "github:acme/web#1",
        label: "Build the page",
        repository: "github:acme/web",
        state: "open",
        parent: "github:acme/web#404",
      },
    ]);

    await expect(
      syncScopes({
        store: newStore(),
        sources: lookup(
          createFakeGraphSource({
            source: "github",
            scopes: { "github:acme": [orphan] },
          }),
        ),
        modelId,
        scopes: ["github:acme"],
      }),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_CONTENT",
      data: {
        issues: [expect.objectContaining({ code: "unknown-reference" })],
      },
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

    const result = await syncScopes({
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
    });

    expect(read).toEqual(["github%3Aacme@0"]);
    expect(result.pages).toBe(1);
    const stored = await store.v1.models.load({ modelId });
    expect(
      stored.model.transitions.map((transition) => transition.id),
    ).toContain("github:acme/api#2->github:acme/web#1");
  });

  test("reads with the filter it is given and records it in every checkpoint", async () => {
    const filters: (SyncFilter | undefined)[] = [];
    const recording: GraphSourcePager = {
      source: "github",
      page: async (request) => {
        filters.push(request.filter);

        return fakeGitHub.page(request);
      },
    };
    const filter: SyncFilter = {
      states: ["open"],
      labels: ["bug"],
      order: { field: "updated", direction: "descending" },
    };
    const progress: SyncProgress[] = [];

    await syncScopes({
      store: newStore(),
      sources: lookup(recording),
      modelId,
      scopes: ["github:acme"],
      filter,
      onProgress: (step) => {
        progress.push(step);
      },
    });

    expect(filters).toEqual([filter, filter]);
    // The fake source's cursor carries the filter it was issued under, as the GitHub adapter's does.
    const checkpoint = progress[0]?.checkpoint;
    expect(checkpoint?.filter).toEqual(filter);
    expect(checkpoint?.after?.startsWith("github%3Aacme@0;")).toBe(true);
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

    await expect(
      syncScopes({
        store,
        sources: lookup(limited),
        modelId,
        scopes: ["github:acme"],
        onProgress: (step) => {
          progress.push(step);
        },
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
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

  test("reads the sources in order and checkpoints the start of the next source between them", async () => {
    const progress: SyncProgress[] = [];
    const jira = createFakeGraphSource({
      source: "jira",
      scopes: {
        "jira:ACME": [
          pageOf([
            {
              id: "jira:ACME-1",
              label: "Plan",
              repository: "jira:ACME/board",
              state: "open",
            },
          ]),
        ],
      },
    });

    await syncScopes({
      store: newStore(),
      sources: lookup(fakeGitHub, jira),
      modelId,
      scopes: ["github:acme", "jira:ACME"],
      onProgress: (step) => {
        progress.push(step);
      },
    });

    expect(progress.map((step) => step.checkpoint)).toEqual([
      {
        modelId,
        scopes: ["github:acme", "jira:ACME"],
        source: "github",
        after: "github%3Aacme@0",
      },
      { modelId, scopes: ["github:acme", "jira:ACME"], source: "jira" },
      undefined,
    ]);
  });

  test("reports the parts of the scope the source could not read", async () => {
    const result = await syncScopes({
      store: newStore(),
      sources: lookup(fakeGitHub),
      modelId: "github:acme github:ghost",
      scopes: ["github:acme", "github:ghost"],
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

    const outcome = syncScopes({
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

  test("refuses a scope whose source no reader serves, and one that names no source", async () => {
    await expect(
      syncScopes({
        store: newStore(),
        sources: lookup(fakeGitHub),
        modelId: "linear:team",
        scopes: ["linear:team"],
      }),
    ).rejects.toThrow(UnknownSourceError);
    await expect(
      syncScopes({
        store: newStore(),
        sources: lookup(fakeGitHub),
        modelId,
        scopes: ["acme/app"],
      }),
    ).rejects.toThrow(InvalidScopeError);
  });

  test("refuses a checkpoint for a source none of the scopes use", async () => {
    await expect(
      syncScopes({
        store: newStore(),
        sources: lookup(fakeGitHub),
        modelId,
        scopes: ["github:acme"],
        resume: { modelId, scopes: ["github:acme"], source: "jira" },
      }),
    ).rejects.toThrow("The checkpoint names a source");
  });
});

describe("scopesBySource", () => {
  test("groups scopes by source, each source where it first appears, its scopes in order", () => {
    expect(
      scopesBySource(["github:a", "jira:X", "github:b/c", "jira:Y"]),
    ).toEqual([
      { prefix: "github", scopes: ["github:a", "github:b/c"] },
      { prefix: "jira", scopes: ["jira:X", "jira:Y"] },
    ]);
  });

  test("names a scope with nothing before its colon", () => {
    expect(() => scopesBySource([":a"])).toThrow(
      '":a" is not a scope: write <source>:<scope>, such as github:owner/repo',
    );
  });
});
