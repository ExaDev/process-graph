import {
  type GraphSourcePager,
  type PageRequest,
  paginate,
  type SyncPage,
} from "@exadev/process-graph-source-contract";
import type { z } from "zod";
import {
  decodeCursor,
  encodeCursor,
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
import { githubSource, issueId, parseScope } from "./identifiers.ts";
import { createPageBuilder, type PageBuilder } from "./page-builder.ts";
import {
  assigneesConnectionSchema,
  blockedByConnectionSchema,
  type Issue,
  type IssueConnection,
  issueConnectionQuery,
  ownerRepositoriesQuery,
  ownerRepositoriesSchema,
  type PageInfo,
  repositoryIssuesQuery,
  repositoryIssuesSchema,
  subIssuesConnectionSchema,
} from "./queries.ts";

/** GitHub's largest allowed `first` on a connection; the API rejects larger values. */
const githubMaxPageSize = 100;

/**
 * Issues per page, and items per request of each issue's assignees, blockers and sub-issues. Half of GitHub's limit keeps a page's GraphQL cost and response moderate while needing few requests; Graphle used the same size.
 */
const defaultPageSize = githubMaxPageSize / 2;

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

/** Records the problems of a response as one gap on `target`, when there are any. */
const recordProblems = (
  builder: PageBuilder,
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
  builder: PageBuilder,
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
 * The GitHub issues `GraphSourcePager`. A page is one page of one repository's issues: each issue becomes a bound activity (`github:owner/repo#n`) whose actor is its repository, each `blockedBy` entry a transition from the blocker, each sub-issue a `child-of` relation, each assignee an `assigned-to` relation, and the repository `part-of` its owner. Blockers and sub-issues in other repositories or organisations are included with their own repository and owner. Open issues are `open` in the overlay and closed ones `done`.
 *
 * Scopes are read in request order, each once: `github:owner/repo` for one repository, `github:owner` for every repository the account owns, by name. A repository or owner that does not exist or that the token cannot see is a gap, and the sync continues.
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
    const [assignees, blockers, children] = await Promise.all([
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
    const { target, repository, after } = read;
    const { data, problems } = await graphql(
      transport,
      {
        query: repositoryIssuesQuery,
        variables: { ...repository, first: pageSize, after },
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

  const read = async ({
    scope,
    cursor,
    signal,
  }: Readonly<PageRequest>): Promise<SyncPage> => {
    const scopes = [...new Set(scope)].map(parseScope);
    const [firstScope] = scopes;
    if (firstScope === undefined) {
      throw new Error("unreachable: the contract requires at least one scope");
    }
    const located =
      cursor === undefined ? startOf(firstScope) : decodeCursor(cursor, scopes);
    const following = scopes[scopes.indexOf(located.scope) + 1];
    const nextScope =
      following === undefined ? undefined : startOf(following).position;
    const builder = createPageBuilder();
    const build = (next: Position | undefined): SyncPage =>
      builder.build(next === undefined ? undefined : encodeCursor(next));

    if (located.kind === "repository") {
      const { scope: current, position } = located;
      const issues = await readRepository(
        builder,
        {
          target: current.id,
          repository: { owner: current.owner, name: current.name },
          after: position.issues,
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

  return { source: githubSource, page: read };
};
