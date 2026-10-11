import { describe, expect, test } from "vitest";
import { readScopeInput } from "./scope-input.ts";

describe("readScopeInput", () => {
  test.each([
    ["acme", "github:acme"],
    ["  acme/api  ", "github:acme/api"],
    ["github:acme/api", "github:acme/api"],
    ["https://github.com/acme", "github:acme"],
    ["https://github.com/acme/api/issues/12", "github:acme/api"],
    ["linear:team-a", "linear:team-a"],
    ["https://github.com/orgs/acme/projects/7", "github:acme/projects/7"],
    [
      "https://github.com/users/alice/projects/2/views/1",
      "github:alice/projects/2",
    ],
    ["acme/projects/7", "github:acme/projects/7"],
  ])("reads %j as %j", (text, scope) => {
    expect(readScopeInput(text)).toEqual({ scope });
  });

  test("asks for something when nothing is typed", () => {
    expect(readScopeInput("   ")).toEqual({
      problem: "Type an organisation, a repository or a GitHub link.",
    });
  });

  test("refuses a board number GitHub cannot have", () => {
    expect(readScopeInput("https://github.com/orgs/acme/projects/0")).toEqual({
      problem:
        '"https://github.com/orgs/acme/projects/0" is not a GitHub organisation, user, repository or project board: write owner, owner/repo or the link to a board.',
    });
  });

  test("refuses what GitHub cannot name", () => {
    expect(readScopeInput("acme/api/extra")).toEqual({
      problem:
        '"acme/api/extra" is not a GitHub organisation, user, repository or project board: write owner, owner/repo or the link to a board.',
    });
    expect(readScopeInput("github:acme corp")).toEqual({
      problem:
        '"github:acme corp" is not a GitHub organisation, user, repository or project board: write owner, owner/repo or the link to a board.',
    });
  });
});
