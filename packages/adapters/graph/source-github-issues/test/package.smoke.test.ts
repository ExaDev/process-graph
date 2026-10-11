import { createGraphSourceRouter } from "@exadev/process-graph-source-contract";
import { inProcessClient } from "@exadev/process-graph-source-contract/conformance";
import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import {
  createGitHubIssuesSource,
  parseScope,
  storedTokenPort,
} from "../dist/index.js";
import { githubTokenFromEnvironment } from "../dist/node.js";

test("the built package reads a page through its fetch port", async () => {
  const body = {
    data: {
      repository: {
        name: "repo",
        owner: { __typename: "Organization", login: "org" },
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      },
    },
  };
  const client = inProcessClient(
    createGraphSourceRouter(
      createGitHubIssuesSource({
        token: async () => Promise.resolve("smoke-test-token"),
        fetch: async () =>
          Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
      }),
    ),
  );
  const page = await client.v1.sync.page({ scope: ["github:org/repo"] });
  expect(page.participants.map((participant) => participant.id)).toEqual([
    "github:@org",
    "github:org/repo",
  ]);
  expect(parseScope("github:org")).toEqual({
    kind: "owner",
    id: "github:org",
    owner: "org",
  });
});

test("the built node entry point reads GITHUB_TOKEN", async () => {
  const port = githubTokenFromEnvironment({
    env: { GITHUB_TOKEN: "from-env" },
  });
  await expect(port("org", undefined)).resolves.toBe("from-env");
});

test("the built package chooses a stored token per owner", async () => {
  const port = storedTokenPort({
    list: async () =>
      Promise.resolve([
        { token: "for-org", owners: ["org"] },
        { token: "for-any", owners: "any" },
      ]),
  });
  await expect(port("org", undefined)).resolves.toBe("for-org");
  await expect(port(undefined, undefined)).resolves.toBe("for-any");
});
