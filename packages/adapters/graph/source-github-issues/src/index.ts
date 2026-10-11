/**
 * The GitHub issues `GraphSource` adapter. `createGitHubIssuesSource` returns a pager for `createGraphSourceRouter` from `@exadev/process-graph-source-contract`, with a scope listing. The token comes from an injected port: `storedTokenPort` chooses among tokens a host keeps, per owner, and `githubTokenFromEnvironment` in the `./node` entry point reads `GITHUB_TOKEN` or the GitHub CLI's token.
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
  ownerScopeId,
  parseScope,
  repositoryId,
  type Scope,
} from "./identifiers.ts";
export {
  selectStoredToken,
  type StoredGitHubToken,
  storedTokenPort,
  type StoredTokenPortOptions,
} from "./tokens.ts";
