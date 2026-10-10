/**
 * Records the GitHub GraphQL exchanges the adapter's offline tests replay. Run from the package directory after a build, with a token in `GITHUB_TOKEN` or the GitHub CLI logged in:
 *
 *   node scripts/record-fixtures.ts
 *
 * It syncs the fixture scopes through the adapter with a fetch that records each request's document and variables and GitHub's status and body, and writes them to `src/test-support/fixtures/github.json`. No header is recorded, so the token never reaches the file. The scopes are public repositories, so the fixture holds only public data.
 */
import { writeFileSync } from "node:fs";
import {
  assembleSync,
  createGraphSourceRouter,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import { inProcessClient } from "@exadev/process-graph-source-contract/conformance";
import { createGitHubIssuesSource } from "../src/source.ts";
import { githubTokenFromEnvironment } from "../src/node.ts";
import {
  type Exchange,
  graphqlRequestOf,
  type Recording,
  requestKey,
} from "../src/test-support/recording.ts";
import {
  fixturePageSize,
  fixtureScope,
  missingOwnerScope,
  missingRepositoryScope,
  unauthorisedScope,
} from "../src/test-support/scopes.ts";

const exchanges = new Map<string, Exchange>();

const recordingFetch = async (
  url: string,
  init: RequestInit,
): Promise<Response> => {
  const request = graphqlRequestOf(init.body);
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  exchanges.set(requestKey(request), {
    request,
    response: { status: response.status, body },
  });

  return new Response(JSON.stringify(body), { status: response.status });
};

const walk = async (
  token: ReturnType<typeof githubTokenFromEnvironment>,
  scope: readonly string[],
): Promise<readonly SyncPage[]> => {
  const client = inProcessClient(
    createGraphSourceRouter(
      createGitHubIssuesSource({
        token,
        fetch: recordingFetch,
        pageSize: fixturePageSize,
      }),
    ),
  );
  const pages: SyncPage[] = [];
  for await (const page of await client.v1.sync.stream({ scope })) {
    pages.push(page);
  }

  return pages;
};

const token = githubTokenFromEnvironment();
const pages = await walk(token, fixtureScope);
await walk(token, [missingOwnerScope, missingRepositoryScope]);
// A made-up token, so GitHub's answer to bad credentials is recorded too. Its scope is read nowhere else, so its request has its own key.
await walk(
  async () => Promise.resolve("not-a-real-token"),
  [unauthorisedScope],
).then(
  () => {
    throw new Error("expected GitHub to reject the made-up token");
  },
  (error: unknown) => {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "UNAUTHORIZED"
    )) {
      throw error;
    }
  },
);

const recording: Recording = {
  exchanges: [...exchanges.values()].sort((a, b) =>
    requestKey(a.request).localeCompare(requestKey(b.request)),
  ),
};
writeFileSync(
  new URL("../src/test-support/fixtures/github.json", import.meta.url),
  `${JSON.stringify(recording, null, 2)}\n`,
);
const { model } = assembleSync(pages);
console.log(
  `recorded ${String(recording.exchanges.length)} exchanges; ${String(pages.length)} pages, ${String(model.elements.length)} activities, ${String(model.transitions.length)} transitions`,
);
