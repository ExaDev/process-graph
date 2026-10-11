import { GraphSourceError } from "@exadev/process-graph-source-contract";
import type { GitHubTokenPort } from "./graphql.ts";

/** A token a host keeps, such as one a person entered in a browser, with what it may be used for. */
export interface StoredGitHubToken {
  /** The token itself. It is only ever returned to the adapter, which sends it in the `Authorization` header. */
  readonly token: string;
  /** The logins of the owners it is for, or `"any"` for a token that serves every owner. */
  readonly owners: readonly string[] | "any";
  /** When it was last used, as an ISO 8601 instant; absent when it never has been. */
  readonly lastUsedAt?: string;
}

/** Orders tokens most recently used first, a token never used last. ISO 8601 instants in UTC order as text. */
const byRecency = (
  left: Readonly<StoredGitHubToken>,
  right: Readonly<StoredGitHubToken>,
): number => (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "");

/**
 * Picks the stored token for a request about one owner. A token scoped to that owner wins over one scoped to any owner; among owner-scoped tokens the one naming the fewest owners wins, being the most specific, then the most recently used; among tokens for any owner the most recently used wins. A request about the token's own holder (`owner` undefined) can only use a token for any owner. Logins match without regard to case, as GitHub's do.
 * @param tokens - The stored tokens.
 * @param owner - The login the request is about, or `undefined` for the token's own holder.
 * @returns The token to use, or `undefined` when none fits.
 */
export const selectStoredToken = (
  tokens: readonly StoredGitHubToken[],
  owner: string | undefined,
): StoredGitHubToken | undefined => {
  const login = owner?.toLowerCase();
  const scoped = tokens
    .flatMap((candidate) =>
      candidate.owners !== "any" &&
      login !== undefined &&
      candidate.owners.some((named) => named.toLowerCase() === login)
        ? [{ candidate, breadth: candidate.owners.length }]
        : [],
    )
    .sort(
      (left, right) =>
        left.breadth - right.breadth ||
        byRecency(left.candidate, right.candidate),
    );
  const [best] = scoped;
  if (best !== undefined) {
    return best.candidate;
  }

  return tokens
    .filter((candidate) => candidate.owners === "any")
    .sort(byRecency)
    .at(0);
};

/** Where `storedTokenPort` reads the host's tokens, and how it reports one being used. */
export interface StoredTokenPortOptions {
  /** Reads the stored tokens; called for every request, so a token added or removed takes effect on the next one. */
  readonly list: (
    signal: AbortSignal | undefined,
  ) => Promise<readonly StoredGitHubToken[]>;
  /** Told of each token chosen, so the host can record when it was used and keep the recency order current. */
  readonly used?: (token: StoredGitHubToken) => void;
}

/**
 * A token port over tokens a host keeps, choosing one per request with `selectStoredToken`.
 * @param options - How to read the stored tokens, and how to report one being used.
 * @returns The token port.
 * @throws GraphSourceError with `unauthorised`, from the port, when no stored token fits the owner; the message names the owner and never a token.
 */
export const storedTokenPort =
  (options: StoredTokenPortOptions): GitHubTokenPort =>
  async (owner, signal) => {
    const chosen = selectStoredToken(await options.list(signal), owner);
    if (chosen === undefined) {
      throw new GraphSourceError({
        kind: "unauthorised",
        message:
          owner === undefined
            ? "no stored GitHub token serves any owner, which a request about the token's holder needs"
            : `no stored GitHub token is for ${owner} or for any owner`,
      });
    }
    options.used?.(chosen);

    return chosen.token;
  };
