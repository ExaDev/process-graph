import {
  assembleSync,
  createGraphSourceRouter,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import {
  graphSourceConformance,
  graphSourceListingConformance,
  inProcessClient,
} from "@exadev/process-graph-source-contract/conformance";
import { describe, expect, test } from "vitest";
import { githubTokenFromEnvironment } from "./node.ts";
import { createGitHubIssuesSource } from "./source.ts";
import {
  fixtureListingParent,
  fixturePageSize,
  fixtureProjectScope,
  fixtureScope,
  missingOwnerScope,
} from "./test-support/scopes.ts";

/**
 * Live tests against GitHub run only when `PROCESS_GRAPH_LIVE_GITHUB` is `1`, with a token in `GITHUB_TOKEN` or the GitHub CLI logged in. Without it they are reported as skipped, never silently absent.
 */
const live = process.env.PROCESS_GRAPH_LIVE_GITHUB === "1";

/** At the default page size: the owner scope still spans a page per repository, so resumption is exercised with fewer requests. */
const liveRouter = () =>
  createGraphSourceRouter(
    createGitHubIssuesSource({ token: githubTokenFromEnvironment() }),
  );

/** At the fixture page size, so the listing parent's repositories span two pages, as they do in the recording. */
const smallPageRouter = () =>
  createGraphSourceRouter(
    createGitHubIssuesSource({
      token: githubTokenFromEnvironment(),
      pageSize: fixturePageSize,
    }),
  );

/**
 * No per-test time limit: how long the live suite takes is GitHub's, not this code's, and each request is already bounded by GitHub's own server-side timeout for GraphQL requests.
 */
const unbounded = 0;

describe.skipIf(!live)(
  "GitHub issues against the live API (set PROCESS_GRAPH_LIVE_GITHUB=1 to run)",
  { timeout: unbounded },
  () => {
    graphSourceConformance({
      name: "GitHub issues, live",
      createClient: () => inProcessClient(liveRouter()),
      scope: fixtureScope,
      missingScope: missingOwnerScope,
      malformedScope: "ExaDev/document-schema.js",
    });

    graphSourceListingConformance({
      name: "GitHub issues, live",
      createClient: () => inProcessClient(smallPageRouter()),
      roots: true,
      parent: fixtureListingParent,
      missingParent: missingOwnerScope,
      malformedParent: "octo-org",
    });

    test("a Projects v2 board syncs its issues", async () => {
      const pages: SyncPage[] = [];
      const client = inProcessClient(liveRouter());
      for await (const page of await client.v1.sync.stream({
        scope: [fixtureProjectScope],
      })) {
        pages.push(page);
      }
      const { model, gaps } = assembleSync(pages);
      expect(gaps).toEqual([]);
      expect(model.elements.map((element) => element.id)).toContain(
        "github:github/semantic#480",
      );
    });

    test("a sync across two organisations keeps the transition between them", async () => {
      const pages: SyncPage[] = [];
      const client = inProcessClient(liveRouter());
      for await (const page of await client.v1.sync.stream({
        scope: [
          "github:Mearman/agent-permissions",
          "github:ExaDev/document-schema.js",
        ],
      })) {
        pages.push(page);
      }
      const { model } = assembleSync(pages);
      expect(model.transitions.map((transition) => transition.id)).toContain(
        "github:ExaDev/trilean#11->github:Mearman/agent-permissions#26",
      );
    });
  },
);
