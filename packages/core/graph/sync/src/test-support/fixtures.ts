import {
  createGraphSourceRouter,
  type FakePage,
  type GraphSourcePager,
  type Relation,
} from "@exadev/process-graph-source-contract";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
  type GraphStoreClient,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import type { SourceLookup } from "../sync.ts";

/** One issue of the fake GitHub source. */
export interface Issue {
  readonly id: string;
  readonly label: string;
  readonly repository: string;
  readonly state: "done" | "open";
  readonly blockedBy?: readonly string[];
  /** The parent issue, for a sub-issue. */
  readonly parent?: string;
  /** The people assigned to it, as account participants. */
  readonly assignees?: readonly string[];
}

const ownerOf = (repository: string): string =>
  `github:@${repository.slice(repository.indexOf(":") + 1, repository.indexOf("/"))}`;

/**
 * A page of the fake GitHub source, built as the real adapter builds one: each issue a bound activity whose actor is its repository, each repository `part-of` its owner, each blocker a transition to the issue it blocks, each sub-issue `child-of` its parent, each assignee a role participant the issue is `assigned-to`, and the state in the overlay.
 * @param issues - The page's issues.
 * @returns The page.
 */
export const pageOf = (issues: readonly Issue[]): FakePage => {
  const repositories = [...new Set(issues.map((issue) => issue.repository))];
  const assignees = [
    ...new Set(issues.flatMap((issue) => issue.assignees ?? [])),
  ];
  const relations: Relation[] = [
    ...repositories.map((repository): Relation => ({
      kind: "part-of",
      from: repository,
      to: ownerOf(repository),
    })),
    ...issues.flatMap((issue): Relation[] => [
      ...(issue.parent === undefined
        ? []
        : [{ kind: "child-of", from: issue.id, to: issue.parent } as const]),
      ...(issue.assignees ?? []).map((person): Relation => ({
        kind: "assigned-to",
        from: issue.id,
        to: person,
      })),
    ]),
  ];

  return {
    participants: [
      ...[...new Set(repositories.map(ownerOf))].map((id) => ({
        id,
        label: id.slice(id.indexOf("@") + 1),
        kind: "system" as const,
      })),
      ...repositories.map((id) => ({
        id,
        label: id.slice(id.indexOf(":") + 1),
        kind: "system" as const,
      })),
      ...assignees.map((id) => ({
        id,
        label: id.slice(id.indexOf("@") + 1),
        kind: "role" as const,
      })),
    ],
    activities: issues.map((issue) => ({
      kind: "activity",
      id: issue.id,
      label: issue.label,
      source: issue.id,
      actor: issue.repository,
    })),
    transitions: issues.flatMap((issue) =>
      (issue.blockedBy ?? []).map((blocker) => ({
        id: `${blocker}->${issue.id}`,
        source: blocker,
        target: issue.id,
      })),
    ),
    relations,
    overlay: Object.fromEntries(issues.map((issue) => [issue.id, issue.state])),
    gaps: [],
  };
};

/** The first page of the fake `github:acme` scope: the API repository's issues, the second a sub-issue of an epic the next page brings. */
export const apiPage: FakePage = pageOf([
  {
    id: "github:acme/api#1",
    label: "Design the schema",
    repository: "github:acme/api",
    state: "done",
    assignees: ["github:@alice"],
  },
  {
    id: "github:acme/api#2",
    label: "Build the endpoint",
    repository: "github:acme/api",
    state: "open",
    blockedBy: ["github:acme/api#1"],
    parent: "github:acme/web#9",
  },
]);

/** The second page of the fake `github:acme` scope: the web repository's issues, the epic among them, with a blocker in the API repository. */
export const webPage: FakePage = pageOf([
  {
    id: "github:acme/web#1",
    label: "Build the page",
    repository: "github:acme/web",
    state: "open",
    blockedBy: ["github:acme/api#2"],
    parent: "github:acme/web#9",
  },
  {
    id: "github:acme/web#9",
    label: "Launch",
    repository: "github:acme/web",
    state: "open",
  },
]);

/** The fake GitHub source's scopes. */
export const fakeScopes: Readonly<Record<string, readonly FakePage[]>> = {
  "github:acme": [apiPage, webPage],
};

/** A fresh in-memory store, through its oRPC client. */
export const newStore = (): GraphStoreClient =>
  createRouterClient(createGraphStoreRouter(createFakeGraphStore()));

/**
 * The source lookup that serves each pager's scopes, by its source prefix, through its oRPC client.
 * @param pagers - The pagers.
 */
export const lookup =
  (...pagers: readonly GraphSourcePager[]): SourceLookup =>
  (prefix) => {
    const pager = pagers.find((candidate) => candidate.source === prefix);

    return pager === undefined
      ? undefined
      : createRouterClient(createGraphSourceRouter(pager));
  };
