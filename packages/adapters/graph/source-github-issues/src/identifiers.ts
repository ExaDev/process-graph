import { GraphSourceError } from "@exadev/process-graph-source-contract";

/** The prefix of every identifier this adapter emits and every scope it accepts. */
export const githubSource = "github";

const prefix = `${githubSource}:`;

/**
 * A GitHub login or repository name as GitHub allows them: letters, digits, hyphens, underscores and dots. Anything else cannot name an account or repository, so a scope containing it is malformed rather than missing.
 */
const namePattern = /^[\w.-]+$/u;

/** What one scope identifier selects. */
export type Scope =
  | { readonly kind: "owner"; readonly id: string; readonly owner: string }
  | {
      readonly kind: "repository";
      readonly id: string;
      readonly owner: string;
      readonly name: string;
    };

/**
 * Parses a scope identifier: `github:owner` selects every repository the account owns, `github:owner/repo` selects one.
 * @param id - The scope identifier.
 * @returns The parsed scope.
 * @throws GraphSourceError with `bad-request` and `invalid-scope` when it is neither form.
 */
export const parseScope = (id: string): Scope => {
  const parts = id.startsWith(prefix) ? id.slice(prefix.length).split("/") : [];
  const [owner, name, ...rest] = parts;
  const valid =
    owner !== undefined &&
    namePattern.test(owner) &&
    rest.length === 0 &&
    (name === undefined || namePattern.test(name));
  if (!valid) {
    throw new GraphSourceError({
      kind: "bad-request",
      message: `"${id}" is not a GitHub scope; expected github:owner or github:owner/repo`,
      reason: "invalid-scope",
      value: id,
    });
  }

  return name === undefined
    ? { kind: "owner", id, owner }
    : { kind: "repository", id, owner, name };
};

/** The identifier of an issue: `github:owner/repo#number`, which is also its element identifier. */
export const issueId = (owner: string, name: string, number: number): string =>
  `${prefix}${owner}/${name}#${String(number)}`;

/** The identifier of a repository participant: `github:owner/repo`. */
export const repositoryId = (owner: string, name: string): string =>
  `${prefix}${owner}/${name}`;

/** The identifier of an account participant, organisation or user: `github:@login`. The `@` keeps it apart from the `github:owner` scope syntax. */
export const accountId = (login: string): string => `${prefix}@${login}`;
