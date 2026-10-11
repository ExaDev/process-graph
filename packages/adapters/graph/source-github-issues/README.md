# @exadev/process-graph-source-github-issues

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../../../targets/process-graph/README.md), which exposes it as `process-graph/source/github`, with its Node token port at `process-graph/source/github/node`.

The GitHub issues adapter for the `GraphSource` port in `@exadev/process-graph-source-contract`. It reads issues, what blocks them, what they block and their sub-issues through GitHub's GraphQL API across any number of organisations, repositories and Projects v2 boards, and returns them as pages of the process model. It also lists the scopes a picker offers. It passes the port's conformance kit. The main entry point imports nothing Node-only; `./node` adds a token helper for Node.

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

| Scope                          | Reads                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `github:owner/repo`            | One repository's issues.                                                                                |
| `github:owner`                 | The issues of every repository the account owns, by repository name.                                    |
| `github:owner/projects/number` | The issues on an organisation's or user's Projects v2 board, in the board's order; other items skipped. |

Scopes are read in the order given, each once. A repository, account or board that does not exist, or that the token cannot see, is a gap on that scope and the sync carries on; anything else that is not one of the forms is a `BAD_REQUEST` with reason `invalid-scope`. A board's pull requests and draft issues are not issues, so a board sync passes over them.

## Filters

A sync's `filter` becomes the arguments of GitHub's issue listing, so the narrowing happens on GitHub's side: `states` `open` and `done` are `OPEN` and `CLOSED`, `labels` keeps issues with any of the labels, and `order` is GitHub's `IssueOrder` (`CREATED_AT`, `UPDATED_AT` or `COMMENTS`, ascending or descending). With no filter every issue is listed, oldest first. A board has no such listing, so a filter on a sync that includes a board scope is a `BAD_REQUEST` with reason `invalid-scope`. A blocker, blocked issue or sub-issue reached from a listed issue is read whatever the filter, since the listed work depends on it.

## Listing scopes

`scopes.roots` lists the viewer's own account and then the organisations it belongs to; `scopes.children` lists the repositories an owner has, by name (a repository or a board has nothing inside it). Each entry carries the scope identifier to sync, its name, its description and URL, and whether GitHub has archived it. An owner that does not exist is a gap on an empty page. The viewer's listing asks the token port for a token with no owner (see Tokens).

## The model it produces

| GitHub                       | Model                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Issue `owner/repo#n`         | A bound activity `github:owner/repo#n`, labelled with its title, its actor the repository |
| Open or closed               | `open` or `done` in the overlay                                                           |
| `blockedBy` and `blocking`   | A transition from the blocker to the issue it blocks, `<blocker>-><issue>`                |
| Sub-issue                    | A `child-of` relation from the sub-issue to its parent                                    |
| Assignee                     | A `role` participant `github:@login` and an `assigned-to` relation from the issue         |
| Repository                   | A `system` participant `github:owner/repo`, `part-of` its owner                           |
| Organisation or user account | A participant `github:@login`: an organisation is a `system`, a user a `role`             |

Blockers, blocked issues and sub-issues in other repositories or organisations are included with their own repository and owner, so a dependency across organisations is a transition between their activities, and a hand-off between actors in the model. A dependency is read from both of its ends, so work blocked in a repository outside the requested scopes is still found from its blocker, and the two reads give one transition. Every connection is read to its end: when an issue has more assignees, blockers, blocked issues or sub-issues than one request returns, the rest are read on their own.

## Paging and resuming

A page is one page of one repository's issues, or of one board's items. The cursor in a page's `next` records the scope, the position in an owner's repository listing, GitHub's own cursor into the issues or items, and the filter, as plain data, so a sync resumes in another process and a cursor is refused under another filter. Without a filter, issues are listed by creation time and repositories by name, so a position stays valid as new issues are opened; ordering by `updated` or `comments` lets an issue move while a sync is under way. If an owner has fewer repositories than when the cursor was issued, the sync carries on after that listing page.

## Errors and rate limits

| GitHub's answer                                                                                                   | Result                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| HTTP 401                                                                                                          | `UNAUTHORIZED`                                                                                                           |
| HTTP 429, HTTP 403 with no requests remaining or naming a secondary rate limit, or a `RATE_LIMITED` GraphQL error | `TOO_MANY_REQUESTS` with `resetAt` when GitHub gives one (`x-ratelimit-reset`, or `retry-after` from the injected clock) |
| A `NOT_FOUND` or `FORBIDDEN` GraphQL error                                                                        | A gap, with GitHub's message                                                                                             |
| Anything else                                                                                                     | An error that ends the call                                                                                              |

A rate-limited sync resumes from the last page's `next` once the limit resets.

## Tokens

The token comes from a `GitHubTokenPort`, `(owner, signal) => Promise<string>`, asked for the owner of each repository or board read, so different organisations can use different credentials, and with `owner` undefined for the viewer's own listing, which no owner names. The token is sent only in the `Authorization` header and never logged or put in an error. A port that cannot supply a token ends the call as `unauthorised`, just as GitHub rejecting one would: a `GraphSourceError` it throws is passed through as it is, and any other error is wrapped in one whose message names the token port and the owner (`the GitHub token port gave no token for <owner>: <its message>`) and whose cause is the port's own error.

`storedTokenPort({ list, used })` chooses among tokens a host keeps (a browser's token store, say), each scoped to some owners or to any: a token naming the owner wins, the one naming the fewest owners first and then the most recently used; otherwise the most recently used token for any owner; a request with no owner takes only a token for any owner. Logins match without regard to case. `list` is read on every request, `used` is told which token was chosen so the host can keep its recency, and no fitting token is `unauthorised`. `selectStoredToken` is the choice on its own.

`githubTokenFromEnvironment()` from `./node` uses `GITHUB_TOKEN` when it is set and not empty, and otherwise asks the GitHub CLI once (`gh auth token`). A failure is reported as `unauthorised` without the CLI's output.

## Options

| Option     | Default                       | Meaning                                                             |
| ---------- | ----------------------------- | ------------------------------------------------------------------- |
| `token`    | required                      | The token port.                                                     |
| `fetch`    | the global `fetch`            | How requests reach GitHub.                                          |
| `now`      | `Date.now`                    | The clock, for `retry-after`.                                       |
| `pageSize` | half of GitHub's limit of 100 | Issues, items or scopes per page, and connection items per request. |

## Tests

The offline tests replay GraphQL exchanges recorded from public repositories (`src/test-support/fixtures/github.json`): GitHub's demo organisation as an owner scope and as a listing, two repositories whose issues block each other across repositories and organisations, one of them also synced under a filter, and a public Projects v2 board of GitHub's own. The fixture holds request documents, variables, statuses and bodies, never headers or tokens. The viewer's listing is never recorded, since it would name the recording account's organisations; it is tested over written responses and live. Re-record it after a build with `node scripts/record-fixtures.ts`, with a token in `GITHUB_TOKEN` or the GitHub CLI logged in.

The live tests run the conformance kit (scope listing included), a cross-organisation sync and a board sync against the real API when `PROCESS_GRAPH_LIVE_GITHUB=1` is set, and are reported as skipped otherwise.

```sh
pnpm build                                        # tsc -b -> dist/ (ESM + .d.ts)
pnpm test                                         # unit tests, including the conformance kit over the recorded fixtures
PROCESS_GRAPH_LIVE_GITHUB=1 pnpm test:integration # the live tests
pnpm test:smoke                                   # the built dist/ exercised as a real artefact
```
