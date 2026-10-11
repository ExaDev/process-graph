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

/** The first path segment of a Projects v2 board's address, by whether an organisation or a user owns it. */
const boardOwnerSegments: ReadonlySet<string> = new Set(["orgs", "users"]);

/**
 * The scope path a GitHub web address names: `https://github.com/owner` an owner, `https://github.com/owner/repo` a repository, with anything after it (`/issues/12`, `/pulls`) ignored, and `https://github.com/orgs/owner/projects/1` or `/users/owner/projects/1` a Projects v2 board, with any view after it ignored.
 */
const fromGitHubUrl = (text: string): string | undefined => {
  if (!URL.canParse(text)) {
    return undefined;
  }
  const url = new URL(text);
  if (url.hostname !== githubHost) {
    return undefined;
  }
  const [first, second, third, fourth] = url.pathname
    .split("/")
    .filter((part) => part !== "");
  if (
    first !== undefined &&
    boardOwnerSegments.has(first) &&
    second !== undefined &&
    third === "projects" &&
    fourth !== undefined
  ) {
    return `${second}/projects/${fourth}`;
  }

  return first === undefined
    ? undefined
    : second === undefined
      ? first
      : `${first}/${second}`;
};

/**
 * Reads what a person typed as a scope. A source-qualified scope is taken as it is; a GitHub web address (of an owner, a repository or a Projects v2 board), `owner/repo`, `owner/projects/number` or `owner` is read as a GitHub scope and checked as the GitHub source checks it.
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
        problem: `"${trimmed}" is not a GitHub organisation, user, repository or project board: write owner, owner/repo or the link to a board.`,
      };
    }
  }

  return { scope };
};
