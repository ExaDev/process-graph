import { githubSource } from "@exadev/process-graph-source-github-issues";

/** A GitHub issue an element is bound to: where it is on the web and the scopes that would read it. */
export interface GitHubIssue {
  /** The issue's page on github.com. */
  readonly url: string;
  /** Its repository, `owner/repo`. */
  readonly repository: string;
  /** The scope of its repository, `github:owner/repo`. */
  readonly repositoryScope: string;
  /** The scope of its owner, `github:owner`. */
  readonly ownerScope: string;
}

const issuePattern = new RegExp(
  `^${githubSource}:(?<owner>[\\w.-]+)/(?<name>[\\w.-]+)#(?<number>[1-9]\\d*)$`,
  "u",
);

/**
 * Reads a GitHub issue's source-qualified identifier, as the GitHub source binds activities: `github:owner/repo#12`.
 * @param source - An activity's source binding.
 * @returns The issue, or `undefined` when the binding is not a GitHub issue.
 */
export const githubIssueOf = (source: string): GitHubIssue | undefined => {
  const groups = issuePattern.exec(source)?.groups;
  if (
    groups?.owner === undefined ||
    groups.name === undefined ||
    groups.number === undefined
  ) {
    return undefined;
  }
  const { owner, name, number } = groups;

  return {
    url: `https://github.com/${owner}/${name}/issues/${number}`,
    repository: `${owner}/${name}`,
    repositoryScope: `${githubSource}:${owner}/${name}`,
    ownerScope: `${githubSource}:${owner}`,
  };
};
