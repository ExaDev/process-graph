import { GraphSourceError } from "@exadev/process-graph-source-contract";
import { describe, expect, test } from "vitest";
import {
  selectStoredToken,
  type StoredGitHubToken,
  storedTokenPort,
} from "./tokens.ts";

// Made-up values: none of these is a credential.
const narrow: StoredGitHubToken = {
  token: "narrow",
  owners: ["octo-org"],
  lastUsedAt: "2026-01-01T00:00:00Z",
};
const broad: StoredGitHubToken = {
  token: "broad",
  owners: ["octo-org", "octocat"],
  lastUsedAt: "2026-06-01T00:00:00Z",
};
const recentAny: StoredGitHubToken = {
  token: "recent-any",
  owners: "any",
  lastUsedAt: "2026-09-01T00:00:00Z",
};
const staleAny: StoredGitHubToken = {
  token: "stale-any",
  owners: "any",
  lastUsedAt: "2025-01-01T00:00:00Z",
};
const unusedAny: StoredGitHubToken = { token: "unused-any", owners: "any" };

describe("selectStoredToken", () => {
  test("prefers the token naming the fewest owners, however recently the others were used", () => {
    expect(
      selectStoredToken([recentAny, broad, narrow], "octo-org")?.token,
    ).toBe("narrow");
  });

  test("breaks a tie in specificity by recency", () => {
    const newer = {
      ...narrow,
      token: "newer",
      lastUsedAt: "2026-02-01T00:00:00Z",
    };
    expect(selectStoredToken([narrow, newer], "octo-org")?.token).toBe("newer");
  });

  test("matches logins without regard to case", () => {
    expect(selectStoredToken([broad], "OCTOCAT")?.token).toBe("broad");
  });

  test("falls back to the most recently used token for any owner, never one scoped to another owner", () => {
    expect(
      selectStoredToken([narrow, unusedAny, staleAny, recentAny], "github")
        ?.token,
    ).toBe("recent-any");
    expect(selectStoredToken([narrow, broad], "github")).toBeUndefined();
  });

  test("serves a request about the token's own holder only with a token for any owner", () => {
    expect(selectStoredToken([narrow, unusedAny], undefined)?.token).toBe(
      "unused-any",
    );
    expect(selectStoredToken([narrow], undefined)).toBeUndefined();
  });
});

describe("storedTokenPort", () => {
  test("reads the tokens on every request and reports the one it used", async () => {
    const stores: (readonly StoredGitHubToken[])[] = [[staleAny], [narrow]];
    const used: string[] = [];
    const port = storedTokenPort({
      list: async () => Promise.resolve(stores.shift() ?? []),
      used: (token) => {
        used.push(token.token);
      },
    });
    await expect(port("octo-org", undefined)).resolves.toBe("stale-any");
    await expect(port("octo-org", undefined)).resolves.toBe("narrow");
    expect(used).toEqual(["stale-any", "narrow"]);
  });

  test("passes the caller's signal to the store", async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const port = storedTokenPort({
      list: async (signal) => {
        signals.push(signal);

        return Promise.resolve([recentAny]);
      },
    });
    await port("octo-org", controller.signal);
    expect(signals).toEqual([controller.signal]);
  });

  test("is unauthorised when no token fits, naming the owner and no token", async () => {
    const port = storedTokenPort({
      list: async () => Promise.resolve([narrow]),
    });
    const failure = port("github", undefined);
    await expect(failure).rejects.toBeInstanceOf(GraphSourceError);
    await expect(failure).rejects.toMatchObject({
      failure: {
        kind: "unauthorised",
        message: "no stored GitHub token is for github or for any owner",
      },
    });
    await expect(port(undefined, undefined)).rejects.toMatchObject({
      failure: { kind: "unauthorised" },
    });
  });
});
