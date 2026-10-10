/**
 * The GitHub issues `GraphSource` adapter. `createGitHubIssuesSource` returns a pager for `createGraphSourceRouter` from `@exadev/process-graph-source-contract`. The token comes from an injected port; `githubTokenFromEnvironment` in the `./node` entry point reads `GITHUB_TOKEN` or the GitHub CLI's token.
 */
export {
  createGitHubIssuesSource,
  type GitHubIssuesSourceOptions,
} from "./source.ts";
export {
  githubGraphqlEndpoint,
  type GitHubTokenPort,
  type GraphqlFetch,
} from "./graphql.ts";
export {
  accountId,
  githubSource,
  issueId,
  parseScope,
  repositoryId,
  type Scope,
} from "./identifiers.ts";
