import { describe, expect, test } from "vitest";
import {
  defaultViewState,
  modelIdOf,
  parseViewState,
  serialiseViewState,
  type ViewState,
} from "./url-state.ts";

const everything: ViewState = {
  scopes: ["github:acme", "github:partner/sdk"],
  view: "sequence",
  selected: "github:acme/web#1",
  filter: {
    statuses: new Set(["ready", "blocked"]),
    actors: new Set(["github:acme/web"]),
    sources: new Set(["github:acme/api"]),
  },
  tab: "handoffs",
  subject: "order",
  scenario: [
    "github:acme/api#2->github:acme/web#1",
    "github:acme/web#1->github:acme/web#2",
  ],
};

describe("view state in the address", () => {
  test("the default view is the empty query, and the empty query is the default view", () => {
    expect(serialiseViewState(defaultViewState)).toBe("");
    expect(parseViewState("")).toEqual({
      state: defaultViewState,
      problems: [],
    });
  });

  test("writes every part as its own parameter, repeated parts in order and set members sorted", () => {
    const query = new URLSearchParams(serialiseViewState(everything));

    expect([...query]).toEqual([
      ["scope", "github:acme"],
      ["scope", "github:partner/sdk"],
      ["view", "sequence"],
      ["list", "handoffs"],
      ["select", "github:acme/web#1"],
      ["status", "blocked"],
      ["status", "ready"],
      ["actor", "github:acme/web"],
      ["source", "github:acme/api"],
      ["subject", "order"],
      ["step", "github:acme/api#2->github:acme/web#1"],
      ["step", "github:acme/web#1->github:acme/web#2"],
    ]);
  });

  test("reads back exactly the state it wrote", () => {
    const { state, problems } = parseViewState(serialiseViewState(everything));

    expect(problems).toEqual([]);
    expect(state).toEqual(everything);
  });

  test("writes back exactly the link it read, whatever order its sets were in", () => {
    const link =
      "?scope=github%3Aacme&view=flowchart&select=github%3Aacme%2Fapi%232&status=done&status=blocked";
    const sorted =
      "?scope=github%3Aacme&view=flowchart&select=github%3Aacme%2Fapi%232&status=blocked&status=done";

    expect(serialiseViewState(parseViewState(link).state)).toBe(sorted);
    expect(serialiseViewState(parseViewState(sorted).state)).toBe(sorted);
  });

  test("keeps each scope once, in the order first given", () => {
    expect(
      parseViewState("?scope=github:b&scope=github:a&scope=github:b").state
        .scopes,
    ).toEqual(["github:b", "github:a"]);
  });

  test("leaves out what it cannot use and names each problem", () => {
    const { state, problems } = parseViewState(
      "?scope=acme&scope=github:acme&view=gantt&list=everything&status=late&status=ready",
    );

    expect(state).toEqual({
      ...defaultViewState,
      scopes: ["github:acme"],
      filter: { ...defaultViewState.filter, statuses: new Set(["ready"]) },
    });
    expect(problems).toEqual([
      'The scope "acme" names no source; write it as source:scope, such as github:owner/repo.',
      'The view "gantt" is not one of flowchart, swimlane, state, sequence.',
      'The list "everything" is not one of ready, blocked, path, handoffs, cycles, issues.',
      'The status "late" is not one of done, unknown, skipped, ready, blocked.',
    ]);
  });
});

describe("modelIdOf", () => {
  test("names the same model for the same scopes in any order, and never repeats a scope", () => {
    expect(modelIdOf(["github:b", "github:a", "github:b"])).toBe(
      "github:a github:b",
    );
    expect(modelIdOf(["github:a", "github:b"])).toBe(
      modelIdOf(["github:b", "github:a"]),
    );
  });
});
