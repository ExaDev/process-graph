import { GraphSourceError } from "@exadev/process-graph-source-contract";

/** The prefix of every identifier this adapter emits and every scope it accepts. */
export const githubSource = "github";

const prefix = `${githubSource}:`;

/**
 * A GitHub login or repository name as GitHub allows them: letters, digits, hyphens, underscores and dots. Anything else cannot name an account or repository, so a scope containing it is malformed rather than missing.
 */
const namePattern = /^[\w.-]+$/u;

/** A Projects v2 board's number as its URL shows it: a positive integer with no leading zero. */
const numberPattern = /^[1-9]\d*$/u;

/** The path segment between an owner and a board's number in a project scope, as in the board's own URL. */
const projectsSegment = "projects";

/** What one scope identifier selects. */
export type Scope =
  | { readonly kind: "owner"; readonly id: string; readonly owner: string }
  | {
      readonly kind: "repository";
      readonly id: string;
      readonly owner: string;
      readonly name: string;
    }
  | {
      readonly kind: "project";
      readonly id: string;
      readonly owner: string;
      readonly number: number;
    };

const invalidScope = (id: string): GraphSourceError =>
  new GraphSourceError({
    kind: "bad-request",
    message: `"${id}" is not a GitHub scope; expected github:owner, github:owner/repo or github:owner/projects/number`,
    reason: "invalid-scope",
    value: id,
  });

/**
 * Parses a scope identifier: `github:owner` selects every repository the account owns, `github:owner/repo` one repository, and `github:owner/projects/number` the issues on an organisation's or user's Projects v2 board. A repository name cannot hold a slash, so the three forms never overlap.
 * @param id - The scope identifier.
 * @returns The parsed scope.
 * @throws GraphSourceError with `bad-request` and `invalid-scope` when it is none of the forms.
 */
export const parseScope = (id: string): Scope => {
  const parts = id.startsWith(prefix) ? id.slice(prefix.length).split("/") : [];
  const [owner, name, number, ...rest] = parts;
  if (owner === undefined || !namePattern.test(owner) || rest.length > 0) {
    throw invalidScope(id);
  }
  if (name === undefined) {
    return { kind: "owner", id, owner };
  }
  if (number === undefined && namePattern.test(name)) {
    return { kind: "repository", id, owner, name };
  }
  if (
    name === projectsSegment &&
    number !== undefined &&
    numberPattern.test(number)
  ) {
    return { kind: "project", id, owner, number: Number(number) };
  }

  throw invalidScope(id);
};

/** The scope identifier of an owner: `github:owner`. */
export const ownerScopeId = (login: string): string => `${prefix}${login}`;

/** The identifier of an issue: `github:owner/repo#number`, which is also its element identifier. */
export const issueId = (owner: string, name: string, number: number): string =>
  `${prefix}${owner}/${name}#${String(number)}`;

/** The identifier of a repository participant: `github:owner/repo`. */
export const repositoryId = (owner: string, name: string): string =>
  `${prefix}${owner}/${name}`;

/** The identifier of an account participant, organisation or user: `github:@login`. The `@` keeps it apart from the `github:owner` scope syntax. */
export const accountId = (login: string): string => `${prefix}@${login}`;
