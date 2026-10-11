import {
  type Gap,
  GraphSourceError,
  type GraphSourcePager,
  type GraphSourceScopes,
  type PageRequest,
  paginate,
  type ScopeEntry,
  type ScopeListing,
  type SyncFilter,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import type { z } from "zod";
import {
  decodeCursor,
  decodeListingCursor,
  encodeCursor,
  encodeListingCursor,
  type Position,
  startOf,
} from "./cursor.ts";
import {
  type GitHubTokenPort,
  graphql,
  type GraphqlFetch,
  type GraphqlTransport,
  type Problem,
} from "./graphql.ts";
import {
  githubSource,
  issueId,
  ownerScopeId,
  parseScope,
  repositoryId,
  type Scope,
} from "./identifiers.ts";
import { createPageBuilder, type PageBuilder } from "./page-builder.ts";
import {
  assigneesConnectionSchema,
  blockedByConnectionSchema,
  blockingConnectionSchema,
  type Issue,
  type IssueConnection,
  issueConnectionQuery,
  type OrganisationEntry,
  ownerRepositoriesQuery,
  ownerRepositoriesSchema,
  type PageInfo,
  projectItemsQuery,
  projectItemsSchema,
  repositoryIssuesQuery,
  repositoryIssuesSchema,
  type RepositoryEntry,
  subIssuesConnectionSchema,
  viewerScopesQuery,
  viewerScopesSchema,
} from "./queries.ts";

/** GitHub's largest allowed `first` on a connection; the API rejects larger values. */
const githubMaxPageSize = 100;

/**
 * Issues per page, and items per request of each issue's assignees, blockers and sub-issues. Half of GitHub's limit keeps a page's GraphQL cost and response moderate while needing few requests; Graphle used the same size.
 */
const defaultPageSize = githubMaxPageSize / 2;

/** GitHub's `IssueState` for each run state a filter selects by: an issue closed for any reason is done. */
const issueStates = { open: "OPEN", done: "CLOSED" } as const;

/** GitHub's `IssueOrderField` for each order field a filter names. */
const issueOrderFields = {
  created: "CREATED_AT",
  updated: "UPDATED_AT",
  comments: "COMMENTS",
} as const;

/** GitHub's `OrderDirection` for each direction a filter names. */
const orderDirections = { ascending: "ASC", descending: "DESC" } as const;

/**
 * The issue listing's variables for a filter. With no filter, or where it says nothing, every issue is listed, oldest first: creation order keeps a cursor's position valid as new issues are opened.
 */
const issueListing = (
  filter: SyncFilter | undefined,
): Readonly<Record<string, unknown>> => ({
  states: (filter?.states ?? (["open", "done"] as const)).map(
    (state) => issueStates[state],
  ),
  labels: filter?.labels ?? null,
  orderBy:
    filter?.order === undefined
      ? {
          field: issueOrderFields.created,
          direction: orderDirections.ascending,
        }
      : {
          field: issueOrderFields[filter.order.field],
          direction: orderDirections[filter.order.direction],
        },
});

/** What the GitHub issues source needs. */
export interface GitHubIssuesSourceOptions {
  /** Supplies a token per owner. `githubTokenFromEnvironment`, from the `./node` entry point, reads `GITHUB_TOKEN` or `gh auth token`. */
  readonly token: GitHubTokenPort;
  /** The fetch implementation; the global `fetch` when absent. */
  readonly fetch?: GraphqlFetch;
  /** The clock, in milliseconds since the epoch; `Date.now` when absent. */
  readonly now?: () => number;
  /** Issues per page, and connection items per request, from 1 to GitHub's limit of 100. */
  readonly pageSize?: number;
}

/** One page of a GraphQL connection, as GitHub returns it. */
interface Connection<Node> {
  readonly pageInfo: PageInfo;
  readonly nodes: readonly (Node | null)[];
}

/** One issue connection to read to its end. */
interface ConnectionRead<Schema extends z.ZodType, Node> {
  /** The issue it belongs to. */
  readonly key: IssueKey;
  readonly connection: IssueConnection;
  /** The page of it the issue query returned. */
  readonly first: Connection<Node>;
  /** The schema of an `issueConnectionQuery` response for it. */
  readonly schema: Schema;
  /** Picks the connection out of such a response. */
  readonly extract: (
    data: z.infer<Schema>,
  ) => Connection<Node> | null | undefined;
}

/** One page of one repository's issues to read. */
interface RepositoryRead {
  /** The identifier a gap for the repository is recorded on. */
  readonly target: string;
  readonly repository: { readonly owner: string; readonly name: string };
  /** GitHub's cursor to read the issues after, or `null` for the first page. */
  readonly after: string | null;
  /** The sync's filter, which narrows and orders the listing. */
  readonly filter: SyncFilter | undefined;
}

/** The issue whose connection is being read. */
interface IssueKey {
  readonly owner: string;
  readonly name: string;
  readonly number: number;
}

const present = <Node>(connection: Connection<Node>): readonly Node[] =>
  connection.nodes.filter((node): node is Node => node !== null);

const endCursorOf = (pageInfo: Readonly<PageInfo>): string | undefined =>
  pageInfo.hasNextPage && pageInfo.endCursor !== null
    ? pageInfo.endCursor
    : undefined;

/** Where gaps are recorded: a page being built, or a listing. */
type GapSink = Pick<PageBuilder, "gap">;

/** A list a listing's gaps are recorded into. */
const gapList = (): {
  readonly gaps: readonly Gap[];
  readonly sink: GapSink;
} => {
  const gaps: Gap[] = [];

  return {
    gaps,
    sink: {
      gap: (gap) => {
        gaps.push(gap);
      },
    },
  };
};

/** Records the problems of a response as one gap on `target`, when there are any. */
const recordProblems = (
  builder: GapSink,
  target: string,
  problems: readonly Problem[],
): void => {
  const [first] = problems;
  if (first !== undefined) {
    builder.gap({
      target,
      reason: first.reason,
      message: problems.map((problem) => problem.message).join("; "),
    });
  }
};

/**
 * Records a scope GitHub answered with null as a gap. GitHub nulls a lookup with a `NOT_FOUND` or `FORBIDDEN` error when it can say why, and with no error at all for an owner login that does not exist, which is equally not found.
 */
const recordAbsence = (
  builder: GapSink,
  target: string,
  problems: readonly Problem[],
): void => {
  if (problems.length === 0) {
    builder.gap({
      target,
      reason: "not-found",
      message: `${target} does not exist or is not visible to the token`,
    });
  } else {
    recordProblems(builder, target, problems);
  }
};

/**
 * The GitHub issues `GraphSourcePager`. A page is one page of one repository's issues, or of one board's items: each issue becomes a bound activity (`github:owner/repo#n`) whose actor is its repository, each `blockedBy` and `blocking` entry a transition from the blocker to the blocked issue (one transition, whichever side it is read from), each sub-issue a `child-of` relation, each assignee an `assigned-to` relation, and the repository `part-of` its owner. Blockers, blocked issues and sub-issues in other repositories or organisations are included with their own repository and owner. Open issues are `open` in the overlay and closed ones `done`.
 *
 * Scopes are read in request order, each once: `github:owner/repo` for one repository, `github:owner` for every repository the account owns, by name, and `github:owner/projects/number` for the issues on an organisation's or user's Projects v2 board, in the board's order (its pull requests and draft issues are not issues, so they are passed over). A repository, owner or board that does not exist or that the token cannot see is a gap, and the sync continues. A filter narrows and orders each repository's issue listing on GitHub's side; a board has no such listing, so a filter with a board scope is a `bad-request` with `invalid-scope`.
 *
 * The pager also lists scopes: the viewer's own account and organisations at the top, and an owner's repositories, by name, inside it.
 * @param options - The token port, and optionally fetch, clock and page size.
 * @returns A pager for `createGraphSourceRouter`.
 * @throws RangeError when `pageSize` is not an integer from 1 to 100.
 */
export const createGitHubIssuesSource = (
  options: GitHubIssuesSourceOptions,
): GraphSourcePager => {
  const pageSize = options.pageSize ?? defaultPageSize;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > githubMaxPageSize
  ) {
    throw new RangeError(
      `pageSize must be an integer from 1 to ${String(githubMaxPageSize)}, not ${String(pageSize)}`,
    );
  }
  const transport: GraphqlTransport = {
    token: options.token,
    // Wrapped rather than passed as is: a browser's fetch throws when called as a method of another object.
    fetch: options.fetch ?? (async (url, init) => fetch(url, init)),
    now: options.now ?? Date.now,
  };

  /** Every node of one issue connection: the page the issue query returned, then the rest read on their own. */
  const allOf = async <Schema extends z.ZodType, Node>(
    read: ConnectionRead<Schema, Node>,
    signal: AbortSignal | undefined,
  ): Promise<readonly Node[]> => {
    const { key, connection, first, schema, extract } = read;
    const after = endCursorOf(first.pageInfo);
    if (after === undefined) {
      return present(first);
    }
    const rest = paginate(after, async (cursor) => {
      const { data } = await graphql(
        transport,
        {
          query: issueConnectionQuery(connection),
          variables: { ...key, first: pageSize, after: cursor },
          owner: key.owner,
          schema,
        },
        signal,
      );
      const page = extract(data);
      if (page === null || page === undefined) {
        throw new Error(
          `${issueId(key.owner, key.name, key.number)} was not returned while its ${connection} were read`,
        );
      }
      const next = endCursorOf(page.pageInfo);

      return next === undefined
        ? { nodes: present(page) }
        : { nodes: present(page), next };
    });
    const nodes = [...present(first)];
    for await (const page of rest) {
      nodes.push(...page.nodes);
    }

    return nodes;
  };

  const addIssue = async (
    builder: PageBuilder,
    issue: Readonly<Issue>,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    const id = builder.issue(issue);
    const key: IssueKey = {
      owner: issue.repository.owner.login,
      name: issue.repository.name,
      number: issue.number,
    };
    const [assignees, blockers, blocked, children] = await Promise.all([
      allOf(
        {
          key,
          connection: "assignees",
          first: issue.assignees,
          schema: assigneesConnectionSchema,
          extract: (data) => data.repository?.issue?.assignees,
        },
        signal,
      ),
      allOf(
        {
          key,
          connection: "blockedBy",
          first: issue.blockedBy,
          schema: blockedByConnectionSchema,
          extract: (data) => data.repository?.issue?.blockedBy,
        },
        signal,
      ),
      allOf(
        {
          key,
          connection: "blocking",
          first: issue.blocking,
          schema: blockingConnectionSchema,
          extract: (data) => data.repository?.issue?.blocking,
        },
        signal,
      ),
      allOf(
        {
          key,
          connection: "subIssues",
          first: issue.subIssues,
          schema: subIssuesConnectionSchema,
          extract: (data) => data.repository?.issue?.subIssues,
        },
        signal,
      ),
    ]);
    for (const user of assignees) {
      builder.assignee(id, user);
    }
    for (const blocker of blockers) {
      builder.blockedBy(id, blocker);
    }
    for (const issueBlocked of blocked) {
      builder.blocking(id, issueBlocked);
    }
    for (const child of children) {
      builder.subIssue(id, child);
    }
  };

  /**
   * Adds one page of a repository's issues to the page.
   * @returns The issues' page info, or `undefined` when the repository was a gap.
   */
  const readRepository = async (
    builder: PageBuilder,
    read: RepositoryRead,
    signal: AbortSignal | undefined,
  ): Promise<PageInfo | undefined> => {
    const { target, repository, after, filter } = read;
    const { data, problems } = await graphql(
      transport,
      {
        query: repositoryIssuesQuery,
        variables: {
          ...repository,
          first: pageSize,
          after,
          ...issueListing(filter),
        },
        owner: repository.owner,
        schema: repositoryIssuesSchema,
      },
      signal,
    );
    if (data.repository === null) {
      recordAbsence(builder, target, problems);

      return undefined;
    }
    recordProblems(builder, target, problems);
    builder.repository(data.repository.owner, data.repository.name);
    await Promise.all(
      present(data.repository.issues).map(async (issue) =>
        addIssue(builder, issue, signal),
      ),
    );

    return data.repository.issues.pageInfo;
  };

  /**
   * Adds one page of a board's items to the page: each issue on it, with its connections.
   * @returns The items' page info, or `undefined` when the owner or board was a gap.
   */
  const readProject = async (
    builder: PageBuilder,
    project: Extract<Scope, { readonly kind: "project" }>,
    after: string | null,
    signal: AbortSignal | undefined,
  ): Promise<PageInfo | undefined> => {
    const { data, problems } = await graphql(
      transport,
      {
        query: projectItemsQuery,
        variables: {
          login: project.owner,
          number: project.number,
          first: pageSize,
          after,
        },
        owner: project.owner,
        schema: projectItemsSchema,
      },
      signal,
    );
    const board = data.repositoryOwner?.projectV2;
    if (board === null || board === undefined) {
      recordAbsence(builder, project.id, problems);

      return undefined;
    }
    recordProblems(builder, project.id, problems);
    const issues = present(board.items).flatMap(({ content }) =>
      content?.__typename === "Issue" ? [content] : [],
    );
    await Promise.all(
      issues.map(async (issue) => addIssue(builder, issue, signal)),
    );

    return board.items.pageInfo;
  };

  const read = async ({
    scope,
    cursor,
    signal,
    filter,
  }: Readonly<PageRequest>): Promise<SyncPage> => {
    const scopes = [...new Set(scope)].map(parseScope);
    const [firstScope] = scopes;
    if (firstScope === undefined) {
      throw new Error("unreachable: the contract requires at least one scope");
    }
    const board = scopes.find((candidate) => candidate.kind === "project");
    if (filter !== undefined && board !== undefined) {
      throw new GraphSourceError({
        kind: "bad-request",
        message: `"${board.id}" is a Projects v2 board, which lists its items in the board's own order and cannot be filtered; sync it without a filter`,
        reason: "invalid-scope",
        value: board.id,
      });
    }
    const located =
      cursor === undefined
        ? startOf(firstScope)
        : decodeCursor(cursor, scopes, filter);
    const following = scopes[scopes.indexOf(located.scope) + 1];
    const nextScope =
      following === undefined ? undefined : startOf(following).position;
    const builder = createPageBuilder();
    const build = (next: Position | undefined): SyncPage =>
      builder.build(
        next === undefined ? undefined : encodeCursor(next, filter),
      );

    if (located.kind === "project") {
      const { scope: current, position } = located;
      const items = await readProject(builder, current, position.items, signal);
      const after = items === undefined ? undefined : endCursorOf(items);

      return build(
        after === undefined ? nextScope : { scope: current.id, items: after },
      );
    }

    if (located.kind === "repository") {
      const { scope: current, position } = located;
      const issues = await readRepository(
        builder,
        {
          target: current.id,
          repository: { owner: current.owner, name: current.name },
          after: position.issues,
          filter,
        },
        signal,
      );
      const after = issues === undefined ? undefined : endCursorOf(issues);

      return build(
        after === undefined ? nextScope : { scope: current.id, issues: after },
      );
    }

    const { scope: current, position } = located;
    const { data, problems } = await graphql(
      transport,
      {
        query: ownerRepositoriesQuery,
        variables: {
          login: current.owner,
          first: pageSize,
          after: position.repositories,
        },
        owner: current.owner,
        schema: ownerRepositoriesSchema,
      },
      signal,
    );
    const owner = data.repositoryOwner;
    if (owner === null) {
      recordAbsence(builder, current.id, problems);

      return build(nextScope);
    }
    recordProblems(builder, current.id, problems);
    builder.account(owner);
    const listed = present(owner.repositories);
    const listingAfter = endCursorOf(owner.repositories.pageInfo);
    const afterListing: Position | undefined =
      listingAfter === undefined
        ? nextScope
        : {
            scope: current.id,
            repositories: listingAfter,
            repository: 0,
            issues: null,
          };
    const repository = listed[position.repository];
    if (repository === undefined) {
      // An owner with no repositories, or a listing page that lost repositories since the cursor was issued: the page holds only the owner, and the sync carries on after the listing page.
      return build(afterListing);
    }
    const issues = await readRepository(
      builder,
      {
        target: `${current.id}/${repository.name}`,
        repository: { owner: owner.login, name: repository.name },
        after: position.issues,
        filter,
      },
      signal,
    );
    const issuesAfter = issues === undefined ? undefined : endCursorOf(issues);
    const afterRepository: Position | undefined =
      position.repository + 1 < listed.length
        ? { ...position, repository: position.repository + 1, issues: null }
        : afterListing;

    return build(
      issuesAfter === undefined
        ? afterRepository
        : { ...position, issues: issuesAfter },
    );
  };

  /** A listing page from its entries, gaps and GitHub's page info, resuming under `parent`. */
  const listingOf = (
    parent: string | null,
    entries: readonly ScopeEntry[],
    gaps: readonly Gap[],
    pageInfo: PageInfo | undefined,
  ): ScopeListing => {
    const after = pageInfo === undefined ? undefined : endCursorOf(pageInfo);

    return after === undefined
      ? { entries, gaps }
      : { entries, gaps, next: encodeListingCursor(parent, after) };
  };

  /** A scope entry, with the description only when GitHub has one. */
  const entryOf = (
    scope: string,
    label: string,
    details: {
      readonly description: string | null;
      readonly url: string;
      readonly archived: boolean;
    },
  ): ScopeEntry => ({
    scope,
    label,
    ...(details.description === null
      ? {}
      : { description: details.description }),
    url: details.url,
    archived: details.archived,
  });

  const organisationEntry = (
    organisation: Readonly<OrganisationEntry>,
  ): ScopeEntry =>
    entryOf(
      ownerScopeId(organisation.login),
      organisation.name ?? organisation.login,
      {
        description: organisation.description,
        url: organisation.url,
        archived: organisation.archivedAt !== null,
      },
    );

  const repositoryEntry = (
    owner: string,
    repository: Readonly<RepositoryEntry>,
  ): ScopeEntry =>
    entryOf(repositoryId(owner, repository.name), repository.name, {
      description: repository.description,
      url: repository.url,
      archived: repository.isArchived,
    });

  const scopes: GraphSourceScopes = {
    roots: async ({ cursor, signal }) => {
      const after =
        cursor === undefined ? null : decodeListingCursor(cursor, null);
      const { data, problems } = await graphql(
        transport,
        {
          query: viewerScopesQuery,
          variables: { first: pageSize, after },
          owner: undefined,
          schema: viewerScopesSchema,
        },
        signal,
      );
      const { viewer } = data;
      const { gaps, sink } = gapList();
      recordProblems(sink, ownerScopeId(viewer.login), problems);
      // The viewer's own account leads the first page: its repositories are a scope like any organisation's.
      const own =
        after === null
          ? [
              entryOf(ownerScopeId(viewer.login), viewer.name ?? viewer.login, {
                description: null,
                url: viewer.url,
                archived: false,
              }),
            ]
          : [];

      return listingOf(
        null,
        [...own, ...present(viewer.organizations).map(organisationEntry)],
        gaps,
        viewer.organizations.pageInfo,
      );
    },
    children: async ({ scope, cursor, signal }) => {
      const parent = parseScope(scope);
      // Only an owner has scopes inside it; a repository or a board is a leaf, so it lists nothing and never issues a cursor.
      if (parent.kind !== "owner") {
        if (cursor !== undefined) {
          throw new GraphSourceError({
            kind: "bad-request",
            message: `"${cursor}" is not a cursor this source issued: ${scope} has no scopes inside it`,
            reason: "invalid-cursor",
            value: cursor,
          });
        }

        return { entries: [], gaps: [] };
      }
      const after =
        cursor === undefined ? null : decodeListingCursor(cursor, scope);
      const { data, problems } = await graphql(
        transport,
        {
          query: ownerRepositoriesQuery,
          variables: { login: parent.owner, first: pageSize, after },
          owner: parent.owner,
          schema: ownerRepositoriesSchema,
        },
        signal,
      );
      const { gaps, sink } = gapList();
      const owner = data.repositoryOwner;
      if (owner === null) {
        recordAbsence(sink, scope, problems);

        return { entries: [], gaps };
      }
      recordProblems(sink, scope, problems);

      return listingOf(
        scope,
        present(owner.repositories).map((repository) =>
          repositoryEntry(owner.login, repository),
        ),
        gaps,
        owner.repositories.pageInfo,
      );
    },
  };

  return { source: githubSource, page: read, scopes };
};
