import { GraphSourceError } from "@exadev/process-graph-source-contract";
import {
  githubSource,
  parseScope,
} from "@exadev/process-graph-source-github-issues";
import { isQualifiedScope } from "./url-state.ts";

/** A scope typed or pasted by a person, read as a source-qualified scope, or why it cannot be. */
export type ScopeInput =
  | { readonly scope: string; readonly problem?: never }
  | { readonly problem: string; readonly scope?: never };

const githubHost = "github.com";

/**
 * The path segments of a GitHub web address that name an account or a repository: `https://github.com/owner` and `https://github.com/owner/repo`, with anything after the repository (`/issues/12`, `/pulls`) ignored.
 */
const fromGitHubUrl = (text: string): string | undefined => {
  if (!URL.canParse(text)) {
    return undefined;
  }
  const url = new URL(text);
  if (url.hostname !== githubHost) {
    return undefined;
  }
  const [owner, name] = url.pathname.split("/").filter((part) => part !== "");

  return owner === undefined
    ? undefined
    : name === undefined
      ? owner
      : `${owner}/${name}`;
};

/**
 * Reads what a person typed as a scope. A source-qualified scope is taken as it is; a GitHub web address, `owner/repo` or `owner` is read as a GitHub scope and checked as the GitHub source checks it.
 * @param text - The text, trimmed of surrounding space.
 * @returns The scope, or a sentence saying why the text is not one.
 */
export const readScopeInput = (text: string): ScopeInput => {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { problem: "Type an organisation, a repository or a GitHub link." };
  }
  const githubPath = fromGitHubUrl(trimmed);
  const scope =
    githubPath !== undefined
      ? `${githubSource}:${githubPath}`
      : isQualifiedScope(trimmed)
        ? trimmed
        : `${githubSource}:${trimmed}`;
  if (scope.startsWith(`${githubSource}:`)) {
    try {
      parseScope(scope);
    } catch (error) {
      if (!(error instanceof GraphSourceError)) {
        throw error;
      }

      return {
        problem: `"${trimmed}" is not a GitHub organisation, user or repository: write owner or owner/repo.`,
      };
    }
  }

  return { scope };
};
