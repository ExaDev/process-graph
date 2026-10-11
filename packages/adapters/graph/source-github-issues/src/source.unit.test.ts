import {
  assembleSync,
  type SyncFilter,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import {
  graphSourceConformance,
  inProcessClient,
  messagePortClient,
} from "@exadev/process-graph-source-contract/conformance";
import { describe, expect, test } from "vitest";
import { createGitHubIssuesSource } from "./source.ts";
import { encodeCursor } from "./cursor.ts";
import { fakeToken, recordedRouter } from "./test-support/sources.ts";
import {
  fixtureFilter,
  fixtureFilteredScope,
  fixtureListingParent,
  fixturePageSize,
  fixtureProjectScope,
  fixtureScope,
  missingOwnerScope,
  missingRepositoryScope,
  unauthorisedScope,
} from "./test-support/scopes.ts";

/** The viewer's own listing is never recorded, since it would name the recording account's organisations; `graphql.unit.test.ts` covers it over written responses, and the live tests run it. */
const listing = {
  roots: false,
  parent: fixtureListingParent,
  missingParent: missingOwnerScope,
  malformedParent: "octo-org",
};

graphSourceConformance({
  name: "GitHub issues over recorded fixtures, in process",
  createClient: () => inProcessClient(recordedRouter().router),
  scope: fixtureScope,
  missingScope: missingOwnerScope,
  malformedScope: "ExaDev/document-schema.js",
  listing,
});

graphSourceConformance({
  name: "GitHub issues over recorded fixtures, over a message port",
  createClient: () => messagePortClient(recordedRouter().router),
  scope: fixtureScope,
  missingScope: missingRepositoryScope,
  malformedScope: "github:ExaDev/document-schema.js/extra",
  listing: { ...listing, malformedParent: "github:octo-org/a/b/c" },
});

const syncAll = async (
  scope: readonly string[],
  filter?: SyncFilter,
): Promise<readonly SyncPage[]> => {
  const client = inProcessClient(recordedRouter().router);
  const pages: SyncPage[] = [];
  for await (const page of await client.v1.sync.stream(
    filter === undefined ? { scope } : { scope, filter },
  )) {
    pages.push(page);
  }

  return pages;
};

describe("the recorded sync", async () => {
  const pages = await syncAll(fixtureScope);
  const { model, overlay, relations, gaps } = assembleSync(pages);
  const transitionIds = model.transitions.map((transition) => transition.id);

  test("makes each issue a bound activity whose actor is its repository", () => {
    expect(model.elements).toContainEqual({
      kind: "activity",
      id: "github:Mearman/agent-permissions#26",
      source: "github:Mearman/agent-permissions#26",
      label:
        "Adopt trilean's pattern-matching builders instead of the hand-rolled parsePattern/matchWildcard/globMatchPath",
      actor: "github:Mearman/agent-permissions",
    });
  });

  test("turns a blocker in another organisation into a transition from it", () => {
    expect(transitionIds).toContain(
      "github:ExaDev/trilean#11->github:Mearman/agent-permissions#26",
    );
    expect(model.elements.map((element) => element.id)).toContain(
      "github:ExaDev/trilean#11",
    );
    expect(relations).toContainEqual({
      kind: "part-of",
      from: "github:ExaDev/trilean",
      to: "github:@ExaDev",
    });
  });

  test("reads every blocker, including those past the first page of the connection", () => {
    expect(
      transitionIds
        .filter((id) => id.endsWith("->github:ExaDev/document-schema.js#22"))
        .sort(),
    ).toEqual([
      "github:ExaDev/markdown-codec#63->github:ExaDev/document-schema.js#22",
      "github:ExaDev/odf.js#59->github:ExaDev/document-schema.js#22",
      "github:ExaDev/ooxml.js#65->github:ExaDev/document-schema.js#22",
      "github:ExaDev/pdf-codec#66->github:ExaDev/document-schema.js#22",
    ]);
    expect(transitionIds).toContain(
      "github:ExaDev/document-schema.js#13->github:ExaDev/document-schema.js#14",
    );
  });

  test("relates every sub-issue to its parent, across repositories and past the first page", () => {
    const children = relations
      .filter(
        (relation) =>
          relation.kind === "child-of" &&
          relation.to === "github:ExaDev/document-schema.js#20",
      )
      .map((relation) => relation.from)
      .sort();
    expect(children).toEqual([
      "github:ExaDev/document-outline.js#2",
      "github:ExaDev/document-schema.js#21",
      "github:ExaDev/document-schema.js#22",
      "github:ExaDev/documents.js#623",
      "github:ExaDev/markdown-codec#63",
      "github:ExaDev/odf.js#59",
      "github:ExaDev/ooxml.js#65",
      "github:ExaDev/pdf-codec#65",
      "github:ExaDev/pdf-codec#66",
    ]);
  });

  test("reads what an issue blocks from its own side, so work blocked in a repository outside the scopes is found", () => {
    expect(transitionIds).toEqual(
      expect.arrayContaining([
        "github:ExaDev/document-schema.js#12->github:ExaDev/documents.js#569",
        "github:ExaDev/document-schema.js#13->github:ExaDev/markdown-codec#54",
        "github:ExaDev/document-schema.js#13->github:ExaDev/odf.js#52",
        "github:ExaDev/document-schema.js#13->github:ExaDev/ooxml.js#51",
      ]),
    );
    expect(model.elements.map((element) => element.id)).toContain(
      "github:ExaDev/documents.js#569",
    );
  });

  test("a dependency read from both of its ends is one transition", () => {
    expect(transitionIds).toEqual([...new Set(transitionIds)]);
    expect(
      transitionIds.filter(
        (id) =>
          id ===
          "github:ExaDev/document-schema.js#13->github:ExaDev/document-schema.js#14",
      ),
    ).toHaveLength(1);
  });

  test("lays closed issues over the model as done", () => {
    expect(overlay["github:ExaDev/document-schema.js#20"]).toBe("done");
    expect(overlay["github:ExaDev/trilean#11"]).toBe("done");
  });

  test("reads every repository of an owner scope, the organisation as a system participant", () => {
    expect(model.participants).toContainEqual({
      id: "github:@octo-org",
      label: "octo-org",
      kind: "system",
    });
    expect(model.participants).toContainEqual({
      id: "github:@Mearman",
      label: "Mearman",
      kind: "role",
    });
    const octoRepositories = relations
      .filter(
        (relation) =>
          relation.kind === "part-of" && relation.to === "github:@octo-org",
      )
      .map((relation) => relation.from)
      .sort();
    expect(octoRepositories).toEqual([
      "github:octo-org/hello-world-javascript-action",
      "github:octo-org/octo-repo-go",
      "github:octo-org/octo-template",
      "github:octo-org/sabrowning1-test",
    ]);
  });

  test("reports no gaps for scopes that exist", () => {
    expect(gaps).toEqual([]);
  });
});

describe("a filtered sync", () => {
  test("lists only the issues in the filter's states and labels, in its order, on GitHub's side", async () => {
    const { router, requests } = recordedRouter();
    const client = inProcessClient(router);
    const pages: SyncPage[] = [];
    for await (const page of await client.v1.sync.stream({
      scope: [fixtureFilteredScope],
      filter: fixtureFilter,
    })) {
      pages.push(page);
    }
    expect(pages.map((page) => page.activities[0]?.id)).toEqual([
      "github:Mearman/agent-permissions#79",
      "github:Mearman/agent-permissions#63",
      "github:Mearman/agent-permissions#56",
      "github:Mearman/agent-permissions#38",
    ]);
    const [first] = pages;
    expect(
      first?.activities
        .slice(0, fixturePageSize)
        .map((activity) => activity.id),
    ).toEqual([
      "github:Mearman/agent-permissions#79",
      "github:Mearman/agent-permissions#65",
      "github:Mearman/agent-permissions#64",
    ]);
    for (const activity of first?.activities.slice(0, fixturePageSize) ?? []) {
      expect(first?.overlay[activity.id]).toBe("done");
    }
    expect(requests[0]).toContain('["labels",["bug"]]');
    expect(requests[0]).toContain(
      '["orderBy",{"field":"CREATED_AT","direction":"DESC"}]',
    );
    expect(requests[0]).toContain('["states",["CLOSED"]]');
  });

  test("a filter with a Projects v2 board is a BAD_REQUEST, since a board's items cannot be filtered", async () => {
    const client = inProcessClient(recordedRouter().router);
    await expect(
      client.v1.sync.page({
        scope: [fixtureFilteredScope, fixtureProjectScope],
        filter: fixtureFilter,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-scope", value: fixtureProjectScope },
    });
  });
});

describe("a Projects v2 board", () => {
  test("syncs the issues on the board in its order, passing over pull requests and draft issues", async () => {
    const pages = await syncAll([fixtureProjectScope]);
    const issues = [
      "github:github/semantic#480",
      "github:github/semantic#482",
      "github:github/semantic#481",
      "github:github/semantic#173",
      "github:github/semantic#172",
      "github:github/semantic#146",
      "github:github/semantic#126",
    ];
    expect(
      pages.flatMap((page) => page.activities.map((activity) => activity.id)),
    ).toEqual(issues);
    expect(pages.length).toBeGreaterThan(2);
    const { model, gaps } = assembleSync(pages);
    expect(model.elements).toContainEqual({
      kind: "activity",
      id: "github:github/semantic#480",
      source: "github:github/semantic#480",
      label: "Precise ASTs don\u2019t support comments",
      actor: "github:github/semantic",
    });
    expect(gaps).toEqual([]);
  });

  test("a board cursor resumes the board", async () => {
    const client = inProcessClient(recordedRouter().router);
    const first = await client.v1.sync.page({ scope: [fixtureProjectScope] });
    const second = await client.v1.sync.page({
      scope: [fixtureProjectScope],
      after: first.next ?? "",
    });
    expect(second.activities.map((activity) => activity.id)).toEqual([
      "github:github/semantic#173",
      "github:github/semantic#172",
      "github:github/semantic#146",
    ]);
  });
});

describe("the scope listing", () => {
  test("lists an owner's repositories by name, with their descriptions and URLs, a page at a time", async () => {
    const client = inProcessClient(recordedRouter().router);
    const first = await client.v1.scopes.children({
      scope: fixtureListingParent,
    });
    expect(first.entries).toEqual([
      {
        scope: "github:octo-org/hello-world-javascript-action",
        label: "hello-world-javascript-action",
        url: "https://github.com/octo-org/hello-world-javascript-action",
        archived: false,
      },
      {
        scope: "github:octo-org/octo-repo-go",
        label: "octo-repo-go",
        description: "fork of octodemo/advanced-security-go",
        url: "https://github.com/octo-org/octo-repo-go",
        archived: false,
      },
      {
        scope: "github:octo-org/octo-template",
        label: "octo-template",
        description: "Welcome to the Octo template.",
        url: "https://github.com/octo-org/octo-template",
        archived: false,
      },
    ]);
    await expect(
      client.v1.scopes.children({
        scope: fixtureListingParent,
        after: first.next ?? "",
      }),
    ).resolves.toEqual({
      entries: [
        {
          scope: "github:octo-org/sabrowning1-test",
          label: "sabrowning1-test",
          url: "https://github.com/octo-org/sabrowning1-test",
          archived: false,
        },
      ],
      gaps: [],
    });
  });

  test("a repository or a board has nothing inside it, and no cursor for it", async () => {
    const client = inProcessClient(recordedRouter().router);
    await expect(
      client.v1.scopes.children({ scope: fixtureFilteredScope }),
    ).resolves.toEqual({ entries: [], gaps: [] });
    await expect(
      client.v1.scopes.children({ scope: fixtureProjectScope }),
    ).resolves.toEqual({ entries: [], gaps: [] });
    await expect(
      client.v1.scopes.children({
        scope: fixtureProjectScope,
        after: "anything",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor", value: "anything" },
    });
  });
});

describe("gaps and failures", () => {
  test("an owner that does not exist is a not-found gap on its scope", async () => {
    const [page] = await syncAll([missingOwnerScope]);
    expect(page?.gaps).toEqual([
      {
        target: missingOwnerScope,
        reason: "not-found",
        message: `${missingOwnerScope} does not exist or is not visible to the token`,
      },
    ]);
  });

  test("a repository that does not exist is a not-found gap with GitHub's message", async () => {
    const [page] = await syncAll([missingRepositoryScope]);
    expect(page?.gaps).toEqual([
      {
        target: missingRepositoryScope,
        reason: "not-found",
        message:
          "Could not resolve to a Repository with the name 'not.a.login/repository'.",
      },
    ]);
  });

  test("a rejected token is UNAUTHORIZED, and the token is not in the error", async () => {
    const client = inProcessClient(recordedRouter().router);
    const failure = client.v1.sync.page({ scope: [unauthorisedScope] });
    await expect(failure).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      defined: true,
    });
    await expect(failure).rejects.not.toSatisfy(
      (error: unknown) =>
        error instanceof Error && error.message.includes(fakeToken),
    );
  });
});

describe("cursors", () => {
  test("a cursor for a scope the request does not contain is invalid", async () => {
    const client = inProcessClient(recordedRouter().router);
    const cursor = encodeCursor(
      { scope: "github:ExaDev/other", issues: null },
      undefined,
    );
    await expect(
      client.v1.sync.page({
        scope: ["github:ExaDev/document-schema.js"],
        after: cursor,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor", value: cursor },
    });
  });

  test("a repository cursor used with an owner scope is invalid", async () => {
    const client = inProcessClient(recordedRouter().router);
    const cursor = encodeCursor(
      { scope: "github:octo-org", issues: null },
      undefined,
    );
    await expect(
      client.v1.sync.page({ scope: ["github:octo-org"], after: cursor }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor" },
    });
  });

  test("a board cursor used with a repository scope is invalid", async () => {
    const client = inProcessClient(recordedRouter().router);
    const cursor = encodeCursor(
      { scope: fixtureFilteredScope, items: null },
      undefined,
    );
    await expect(
      client.v1.sync.page({ scope: [fixtureFilteredScope], after: cursor }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor" },
    });
  });

  test("a cursor past the repositories an owner now has carries on after the listing", async () => {
    const client = inProcessClient(recordedRouter().router);
    const cursor = encodeCursor(
      {
        scope: "github:octo-org",
        repositories: null,
        repository: 50,
        issues: null,
      },
      undefined,
    );
    const page = await client.v1.sync.page({
      scope: ["github:octo-org", "github:ExaDev/document-schema.js"],
      after: cursor,
    });
    expect(page.activities).toEqual([]);
    expect(page.participants).toEqual([
      { id: "github:@octo-org", label: "octo-org", kind: "system" },
    ]);
    const next = await client.v1.sync.page({
      scope: ["github:octo-org", "github:ExaDev/document-schema.js"],
      after: page.next ?? "",
    });
    expect(next.participants.map((participant) => participant.id)).toContain(
      "github:octo-org/sabrowning1-test",
    );
  });
});

describe("createGitHubIssuesSource", () => {
  const githubLimit = 100;
  const fractional = 2.5;

  test.each([0, githubLimit + 1, fractional])(
    "rejects a page size of %s",
    (pageSize) => {
      expect(() =>
        createGitHubIssuesSource({
          token: async () => Promise.resolve(fakeToken),
          pageSize,
        }),
      ).toThrow(RangeError);
    },
  );

  test("asks the token port for the owner of the repository being read", async () => {
    const owners: (string | undefined)[] = [];
    const source = createGitHubIssuesSource({
      token: async (owner) => {
        owners.push(owner);

        return Promise.resolve(fakeToken);
      },
      fetch: async () => Promise.reject(new Error("offline")),
    });
    await expect(
      source.page({
        scope: ["github:ExaDev/document-schema.js"],
        cursor: undefined,
        signal: undefined,
      }),
    ).rejects.toThrow("offline");
    expect(owners).toEqual(["ExaDev"]);
  });
});
