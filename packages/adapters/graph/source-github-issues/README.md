# @exadev/process-graph-source-github-issues

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@exadev/process-graph-source-github-issues) [![Release](https://img.shields.io/github/v/release/ExaDev/process-graph)](https://github.com/ExaDev/process-graph/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

The GitHub issues adapter for the `GraphSource` port in `@exadev/process-graph-source-contract`. It reads issues, their blockers and sub-issues through GitHub's GraphQL API across any number of organisations and repositories, and returns them as pages of the process model. It passes the port's conformance kit. The main entry point imports nothing Node-only; `./node` adds a token helper for Node.

```ts
import { createRouterClient } from "@orpc/server";
import {
  assembleSync,
  createGraphSourceRouter,
} from "@exadev/process-graph-source-contract";
import { createGitHubIssuesSource } from "@exadev/process-graph-source-github-issues";
import { githubTokenFromEnvironment } from "@exadev/process-graph-source-github-issues/node";

const client = createRouterClient(
  createGraphSourceRouter(
    createGitHubIssuesSource({ token: githubTokenFromEnvironment() }),
  ),
);

const pages = [];
for await (const page of await client.v1.sync.stream({
  scope: ["github:ExaDev", "github:Mearman/agent-permissions"],
})) {
  pages.push(page);
}
const { model, overlay, relations, gaps } = assembleSync(pages);
```

## Scopes

| Scope               | Reads                                                                |
| ------------------- | -------------------------------------------------------------------- |
| `github:owner/repo` | One repository's issues.                                             |
| `github:owner`      | The issues of every repository the account owns, by repository name. |

Scopes are read in the order given, each once. A repository or account that does not exist, or that the token cannot see, is a gap on that scope and the sync carries on; anything else that is not one of the two forms is a `BAD_REQUEST` with reason `invalid-scope`.

## The model it produces

| GitHub                       | Model                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Issue `owner/repo#n`         | A bound activity `github:owner/repo#n`, labelled with its title, its actor the repository |
| Open or closed               | `open` or `done` in the overlay                                                           |
| `blockedBy`                  | A transition from the blocker to the issue it blocks, `<blocker>-><issue>`                |
| Sub-issue                    | A `child-of` relation from the sub-issue to its parent                                    |
| Assignee                     | A `role` participant `github:@login` and an `assigned-to` relation from the issue         |
| Repository                   | A `system` participant `github:owner/repo`, `part-of` its owner                           |
| Organisation or user account | A participant `github:@login`: an organisation is a `system`, a user a `role`             |

Blockers and sub-issues in other repositories or organisations are included with their own repository and owner, so a dependency across organisations is a transition between their activities, and a hand-off between actors in the model. Every connection is read to its end: when an issue has more assignees, blockers or sub-issues than one request returns, the rest are read on their own.

## Paging and resuming

A page is one page of one repository's issues, oldest first. The cursor in a page's `next` records the scope, the position in an owner's repository listing and GitHub's own cursor into the issues, as plain data, so a sync resumes in another process. Issues are listed by creation time and repositories by name, so a position stays valid as new issues are opened. If an owner has fewer repositories than when the cursor was issued, the sync carries on after that listing page.

## Errors and rate limits

| GitHub's answer                                                                                                   | Result                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| HTTP 401                                                                                                          | `UNAUTHORIZED`                                                                                                           |
| HTTP 429, HTTP 403 with no requests remaining or naming a secondary rate limit, or a `RATE_LIMITED` GraphQL error | `TOO_MANY_REQUESTS` with `resetAt` when GitHub gives one (`x-ratelimit-reset`, or `retry-after` from the injected clock) |
| A `NOT_FOUND` or `FORBIDDEN` GraphQL error                                                                        | A gap, with GitHub's message                                                                                             |
| Anything else                                                                                                     | An error that ends the call                                                                                              |

A rate-limited sync resumes from the last page's `next` once the limit resets.

## Tokens

The token comes from a `GitHubTokenPort`, `(owner, signal) => Promise<string>`, asked for the owner of each repository read, so different organisations can use different credentials. The token is sent only in the `Authorization` header and never logged or put in an error.

`githubTokenFromEnvironment()` from `./node` uses `GITHUB_TOKEN` when it is set and not empty, and otherwise asks the GitHub CLI once (`gh auth token`). A failure is reported as `unauthorised` without the CLI's output.

## Options

| Option     | Default                       | Meaning                                            |
| ---------- | ----------------------------- | -------------------------------------------------- |
| `token`    | required                      | The token port.                                    |
| `fetch`    | the global `fetch`            | How requests reach GitHub.                         |
| `now`      | `Date.now`                    | The clock, for `retry-after`.                      |
| `pageSize` | half of GitHub's limit of 100 | Issues per page, and connection items per request. |

## Tests

The offline tests replay GraphQL exchanges recorded from public repositories (`src/test-support/fixtures/github.json`): GitHub's demo organisation as an owner scope, and two repositories whose issues block each other across repositories and organisations. The fixture holds request documents, variables, statuses and bodies, never headers or tokens. Re-record it after a build with `node scripts/record-fixtures.ts`, with a token in `GITHUB_TOKEN` or the GitHub CLI logged in.

The live tests run the conformance kit and a cross-organisation sync against the real API when `PROCESS_GRAPH_LIVE_GITHUB=1` is set, and are reported as skipped otherwise.

```sh
pnpm build                                        # tsc -b -> dist/ (ESM + .d.ts)
pnpm test                                         # unit tests, including the conformance kit over the recorded fixtures
PROCESS_GRAPH_LIVE_GITHUB=1 pnpm test:integration # the live tests
pnpm test:smoke                                   # the built dist/ exercised as a real artefact
```
