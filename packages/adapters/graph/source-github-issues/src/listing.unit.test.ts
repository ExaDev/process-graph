import { createGraphSourceRouter } from "@exadev/process-graph-source-contract";
import { inProcessClient } from "@exadev/process-graph-source-contract/conformance";
import { describe, expect, test } from "vitest";
import type { GraphqlFetch } from "./graphql.ts";
import { createGitHubIssuesSource } from "./source.ts";
import { graphqlRequestOf } from "./test-support/recording.ts";
import { fakeToken, fixedNow } from "./test-support/sources.ts";

/**
 * The viewer's own listing over written responses in the shape of GitHub's documentation examples (`octocat`, `octo-org`), since a recording would name the recording account's organisations.
 */

const ok = 200;
const pageSize = 2;

const viewerPage = (
  organisations: readonly unknown[],
  endCursor: string | null,
) => ({
  data: {
    viewer: {
      login: "octocat",
      name: "The Octocat",
      url: "https://github.com/octocat",
      organizations: {
        pageInfo: { hasNextPage: endCursor !== null, endCursor },
        nodes: organisations,
      },
    },
  },
});

const octoOrg = {
  login: "octo-org",
  name: "Octo Org",
  description: "The demonstration organisation",
  url: "https://github.com/octo-org",
  archivedAt: null,
};
const retired = {
  login: "octo-retired",
  name: null,
  description: null,
  url: "https://github.com/octo-retired",
  archivedAt: "2025-01-01T00:00:00Z",
};
const later = {
  login: "octo-later",
  name: "Octo Later",
  description: null,
  url: "https://github.com/octo-later",
  archivedAt: null,
};

/** Answers the viewer listing by its `after` variable: two organisations, then one more. */
const viewerFetch: GraphqlFetch = async (_url, init) => {
  const { variables } = graphqlRequestOf(init.body);
  const body =
    variables.after === null
      ? viewerPage([octoOrg, retired], "page-two")
      : viewerPage([later], null);

  return Promise.resolve(new Response(JSON.stringify(body), { status: ok }));
};

/** The adapter over `fetch`, recording which owner each token request named. */
const routerWith = (fetch: GraphqlFetch) => {
  const owners: (string | undefined)[] = [];
  const router = createGraphSourceRouter(
    createGitHubIssuesSource({
      token: async (owner) => {
        owners.push(owner);

        return Promise.resolve(fakeToken);
      },
      fetch,
      now: () => fixedNow,
      pageSize,
    }),
  );

  return { client: inProcessClient(router), owners };
};

describe("the viewer's top-level scopes", () => {
  test("lead with the viewer's own account, then its organisations, archived ones marked", async () => {
    const { client } = routerWith(viewerFetch);
    const first = await client.v1.scopes.roots({});
    expect(first.entries).toEqual([
      {
        scope: "github:octocat",
        label: "The Octocat",
        url: "https://github.com/octocat",
        archived: false,
      },
      {
        scope: "github:octo-org",
        label: "Octo Org",
        description: "The demonstration organisation",
        url: "https://github.com/octo-org",
        archived: false,
      },
      {
        scope: "github:octo-retired",
        label: "octo-retired",
        url: "https://github.com/octo-retired",
        archived: true,
      },
    ]);
    expect(first.gaps).toEqual([]);
    await expect(
      client.v1.scopes.roots({ after: first.next ?? "" }),
    ).resolves.toEqual({
      entries: [
        {
          scope: "github:octo-later",
          label: "Octo Later",
          url: "https://github.com/octo-later",
          archived: false,
        },
      ],
      gaps: [],
    });
  });

  test("ask the token port for the token's own holder, which no owner names", async () => {
    const { client, owners } = routerWith(viewerFetch);
    await client.v1.scopes.roots({});
    expect(owners).toEqual([undefined]);
  });

  test("refuse a cursor from an owner's listing", async () => {
    const { client } = routerWith(viewerFetch);
    const first = await client.v1.scopes.roots({});
    await expect(
      client.v1.scopes.children({
        scope: "github:octo-org",
        after: first.next ?? "",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor" },
    });
  });
});

describe("an owner's repositories", () => {
  test("mark an archived repository and ask for the owner's token", async () => {
    const { client, owners } = routerWith(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              repositoryOwner: {
                __typename: "Organization",
                login: "octo-org",
                repositories: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      name: "octo-attic",
                      description: null,
                      url: "https://github.com/octo-org/octo-attic",
                      isArchived: true,
                    },
                  ],
                },
              },
            },
          }),
          { status: ok },
        ),
      ),
    );
    await expect(
      client.v1.scopes.children({ scope: "github:octo-org" }),
    ).resolves.toEqual({
      entries: [
        {
          scope: "github:octo-org/octo-attic",
          label: "octo-attic",
          url: "https://github.com/octo-org/octo-attic",
          archived: true,
        },
      ],
      gaps: [],
    });
    expect(owners).toEqual(["octo-org"]);
  });
});
