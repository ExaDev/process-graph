import { GraphSourceError } from "@exadev/process-graph-source-contract";
import { describe, expect, test } from "vitest";
import { accountId, issueId, parseScope, repositoryId } from "./identifiers.ts";

/** The failure a call throws as a `GraphSourceError`, or `undefined` when it does not. */
const failureOf = (
  call: () => unknown,
): GraphSourceError["failure"] | undefined => {
  try {
    call();
  } catch (error) {
    if (error instanceof GraphSourceError) {
      return error.failure;
    }
  }

  return undefined;
};

describe("parseScope", () => {
  test("reads an owner scope and a repository scope", () => {
    expect(parseScope("github:ExaDev")).toEqual({
      kind: "owner",
      id: "github:ExaDev",
      owner: "ExaDev",
    });
    expect(parseScope("github:ExaDev/document-schema.js")).toEqual({
      kind: "repository",
      id: "github:ExaDev/document-schema.js",
      owner: "ExaDev",
      name: "document-schema.js",
    });
  });

  test.each([
    "ExaDev",
    "github:",
    "github:/repo",
    "github:a/b/c",
    "github:a b",
    "linear:team",
    "github:ExaDev/",
  ])("rejects %s as invalid-scope", (scope) => {
    expect(failureOf(() => parseScope(scope))).toEqual({
      kind: "bad-request",
      message: `"${scope}" is not a GitHub scope; expected github:owner or github:owner/repo`,
      reason: "invalid-scope",
      value: scope,
    });
  });
});

describe("identifiers", () => {
  test("are source-qualified", () => {
    const number = 11;
    expect(issueId("ExaDev", "trilean", number)).toBe(
      "github:ExaDev/trilean#11",
    );
    expect(repositoryId("ExaDev", "trilean")).toBe("github:ExaDev/trilean");
    expect(accountId("ExaDev")).toBe("github:@ExaDev");
  });
});
