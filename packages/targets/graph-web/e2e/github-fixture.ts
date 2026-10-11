import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for GitHub's GraphQL API, served on a local port for the end-to-end tests. It answers the operations the GitHub issues source sends for a sync and a scope listing (`ViewerScopes`, `OwnerRepositories`, `RepositoryIssues` and `ProjectItems`) from a fixed set of issues, with every field the source selects and the response shapes GitHub gives, so a change to the source's queries that the fixture does not follow fails the tests at the source's own parse, and the same refusals: HTTP 401 for a token it does not know, and HTTP 403 with no requests remaining for the rate-limited token. CORS headers are the ones api.github.com sends, so a browser reads the rate limit headers as it would from GitHub.
 */

type AccountType = "Organization" | "User";

interface FixtureIssue {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN" | "CLOSED";
  readonly blockedBy: readonly (readonly [string, string, number])[];
  readonly assignees: readonly string[];
  /** The issue this one is a sub-issue of, by owner, repository and number. */
  readonly parent?: readonly [string, string, number];
}

/** The accounts the fixture knows, and the repositories each owns, by name. */
const accounts: Readonly<
  Record<
    string,
    { readonly type: AccountType; readonly repositories: readonly string[] }
  >
> = {
  acme: { type: "Organization", repositories: ["api", "web"] },
  partner: { type: "Organization", repositories: ["docs", "sdk"] },
  alice: { type: "User", repositories: [] },
};

/**
 * The issues. `acme` holds the work: a schema, the endpoint on it, the page on the endpoint and the release on the page. The page also waits on an SDK in another organisation's repository, and has a sub-issue documenting it in a third, so a sync of `acme` follows both links across organisations into `partner/sdk` and `partner/docs`, which are outside the scope. `partner/docs` also holds an issue nothing links to, which only a sync of that repository reads.
 */
export const fixtureIssues: readonly FixtureIssue[] = [
  {
    owner: "acme",
    repository: "api",
    number: 1,
    title: "Design the schema",
    state: "CLOSED",
    blockedBy: [],
    assignees: [],
  },
  {
    owner: "acme",
    repository: "api",
    number: 2,
    title: "Build the endpoint",
    state: "OPEN",
    blockedBy: [["acme", "api", 1]],
    assignees: [],
  },
  {
    owner: "acme",
    repository: "web",
    number: 1,
    title: "Build the page",
    state: "OPEN",
    blockedBy: [
      ["acme", "api", 2],
      ["partner", "sdk", 1],
    ],
    assignees: [],
  },
  {
    owner: "acme",
    repository: "web",
    number: 2,
    title: "Ship the release",
    state: "OPEN",
    blockedBy: [["acme", "web", 1]],
    assignees: ["alice"],
  },
  {
    owner: "partner",
    repository: "sdk",
    number: 1,
    title: "Publish the SDK",
    state: "OPEN",
    blockedBy: [],
    assignees: [],
  },
  {
    owner: "partner",
    repository: "docs",
    number: 1,
    title: "Document the page",
    state: "CLOSED",
    blockedBy: [],
    assignees: [],
    parent: ["acme", "web", 1],
  },
  {
    owner: "partner",
    repository: "docs",
    number: 2,
    title: "Proofread the guide",
    state: "CLOSED",
    blockedBy: [],
    assignees: [],
  },
];

/** The token the fixture accepts. It is made up, and the tests check it is sent only to GitHub's API host. */
export const fixtureToken = "fixture-token-for-the-end-to-end-tests";

/** A token the fixture answers as GitHub answers an exhausted rate limit. */
export const rateLimitedToken = "fixture-token-that-is-rate-limited";

/** When the fixture's rate limit resets, in seconds since the epoch, as `x-ratelimit-reset` gives it. */
export const rateLimitResetSeconds = 4_102_444_800;

/** The HTTP statuses the fixture answers with, as GitHub does. */
const httpStatus = {
  ok: 200,
  noContent: 204,
  unauthorised: 401,
  forbidden: 403,
  serverError: 500,
} as const;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-expose-headers":
    "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after",
};

const ownerOf = (login: string) => {
  const account = accounts[login];
  if (account === undefined) {
    throw new Error(`the fixture has no account ${login}`);
  }

  return { __typename: account.type, login };
};

const findIssue = (owner: string, repository: string, number: number) => {
  const issue = fixtureIssues.find(
    (candidate) =>
      candidate.owner === owner &&
      candidate.repository === repository &&
      candidate.number === number,
  );
  if (issue === undefined) {
    throw new Error(
      `the fixture has no issue ${owner}/${repository}#${String(number)}`,
    );
  }

  return issue;
};

const refOf = (owner: string, repository: string, number: number) => ({
  number,
  title: findIssue(owner, repository, number).title,
  state: findIssue(owner, repository, number).state,
  repository: { name: repository, owner: ownerOf(owner) },
});

const connection = <T>(nodes: readonly T[]) => ({
  pageInfo: { hasNextPage: false, endCursor: null },
  nodes,
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`the request's ${key} is not a string`);
  }

  return value;
};

/** The `data` of a GraphQL response, and any errors beside it. */
interface Answer {
  readonly data: unknown;
  readonly errors?: readonly {
    readonly type: string;
    readonly message: string;
  }[];
}

/** The viewer the fixture token belongs to: a user who is a member of both organisations. */
const viewer = { login: "alice", organisations: ["acme", "partner"] } as const;

/** The Projects v2 boards, by owner and number: their items in board order, an issue by its owner, repository and number, or a draft that is not an issue. */
const boards: Readonly<
  Record<string, readonly (readonly [string, string, number] | "draft")[]>
> = {
  "acme/1": [["acme", "web", 2], "draft", ["acme", "api", 2]],
};

const sameIssue =
  (owner: string, repository: string, number: number) =>
  (candidate: readonly [string, string, number]): boolean =>
    candidate[0] === owner &&
    candidate[1] === repository &&
    candidate[2] === number;

/** An issue as a listing or a board item returns it: its fields and the first page of each connection. `blocking` is the inverse of every issue's `blockedBy`, as GitHub keeps the two, and `subIssues` the inverse of every issue's `parent`. */
const issueOf = (issue: FixtureIssue) => ({
  ...refOf(issue.owner, issue.repository, issue.number),
  assignees: connection(issue.assignees.map((login) => ({ login }))),
  blockedBy: connection(
    issue.blockedBy.map(([owner, repository, number]) =>
      refOf(owner, repository, number),
    ),
  ),
  blocking: connection(
    fixtureIssues
      .filter((other) =>
        other.blockedBy.some(
          sameIssue(issue.owner, issue.repository, issue.number),
        ),
      )
      .map((other) => refOf(other.owner, other.repository, other.number)),
  ),
  subIssues: connection(
    fixtureIssues
      .filter(
        (other) =>
          other.parent !== undefined &&
          sameIssue(issue.owner, issue.repository, issue.number)(other.parent),
      )
      .map((other) => refOf(other.owner, other.repository, other.number)),
  ),
});

const notFound = (data: unknown, message: string): Answer => ({
  data,
  errors: [{ type: "NOT_FOUND", message }],
});

/** GitHub's `IssueState` values the listing's `states` variable selects. */
const statesOf = (variables: Readonly<Record<string, unknown>>) => {
  const states = variables.states;
  if (
    !Array.isArray(states) ||
    !states.every((state) => state === "OPEN" || state === "CLOSED")
  ) {
    throw new Error("the request's states are not GitHub issue states");
  }

  return new Set<string>(states);
};

const answer = (
  query: string,
  variables: Readonly<Record<string, unknown>>,
): Answer => {
  if (query.includes("query ViewerScopes")) {
    return {
      data: {
        viewer: {
          login: viewer.login,
          name: "Alice",
          url: `https://github.com/${viewer.login}`,
          organizations: connection(
            viewer.organisations.map((login) => ({
              login,
              name: login,
              description: null,
              url: `https://github.com/${login}`,
              archivedAt: null,
            })),
          ),
        },
      },
    };
  }
  if (query.includes("query OwnerRepositories")) {
    const login = stringOf(variables, "login");
    const account = accounts[login];
    if (account === undefined) {
      return notFound(
        { repositoryOwner: null },
        `Could not resolve to a RepositoryOwner with the login of '${login}'.`,
      );
    }

    return {
      data: {
        repositoryOwner: {
          ...ownerOf(login),
          repositories: connection(
            account.repositories.map((name) => ({
              name,
              description: null,
              url: `https://github.com/${login}/${name}`,
              isArchived: false,
            })),
          ),
        },
      },
    };
  }
  if (query.includes("query RepositoryIssues")) {
    const owner = stringOf(variables, "owner");
    const name = stringOf(variables, "name");
    if (accounts[owner]?.repositories.includes(name) !== true) {
      return notFound(
        { repository: null },
        `Could not resolve to a Repository with the name '${owner}/${name}'.`,
      );
    }
    if (variables.labels !== null) {
      throw new Error("the fixture's issues carry no labels to filter by");
    }
    const states = statesOf(variables);
    const issues = fixtureIssues
      .filter(
        (issue) =>
          issue.owner === owner &&
          issue.repository === name &&
          states.has(issue.state),
      )
      .map(issueOf);

    return {
      data: {
        repository: { name, owner: ownerOf(owner), issues: connection(issues) },
      },
    };
  }
  if (query.includes("query ProjectItems")) {
    const login = stringOf(variables, "login");
    const number = variables.number;
    if (typeof number !== "number") {
      throw new Error("the request's project number is not a number");
    }
    const items = boards[`${login}/${String(number)}`];
    if (accounts[login] === undefined) {
      return notFound(
        { repositoryOwner: null },
        `Could not resolve to a RepositoryOwner with the login of '${login}'.`,
      );
    }
    if (items === undefined) {
      return notFound(
        { repositoryOwner: { ...ownerOf(login), projectV2: null } },
        `Could not resolve to a ProjectV2 with the number ${String(number)}.`,
      );
    }

    return {
      data: {
        repositoryOwner: {
          ...ownerOf(login),
          projectV2: {
            items: connection(
              items.map((item) => ({
                content:
                  item === "draft"
                    ? { __typename: "DraftIssue" }
                    : {
                        __typename: "Issue",
                        ...issueOf(findIssue(...item)),
                      },
              })),
            ),
          },
        },
      },
    };
  }
  throw new Error(
    "the fixture answers only the GitHub issues source's sync and listing queries",
  );
};

const bodyOf = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) {
      throw new Error("the request body is not bytes");
    }
    chunks.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  return parsed;
};

/** A running fixture: where it listens, and how to stop it. */
export interface GitHubFixture {
  /** The GraphQL endpoint's URL. */
  readonly url: string;
  readonly close: () => Promise<void>;
}

/**
 * Starts the fixture on a free local port.
 * @returns The running fixture.
 */
export const startGitHubFixture = async (): Promise<GitHubFixture> => {
  const server: Server = createServer((request, response) => {
    const send = (
      status: number,
      body: unknown,
      headers: Readonly<Record<string, string>> = {},
    ): void => {
      response.writeHead(status, {
        ...corsHeaders,
        "content-type": "application/json",
        ...headers,
      });
      response.end(JSON.stringify(body));
    };
    if (request.method === "OPTIONS") {
      response.writeHead(httpStatus.noContent, corsHeaders);
      response.end();

      return;
    }
    const authorisation = request.headers.authorization;
    if (authorisation === `Bearer ${rateLimitedToken}`) {
      send(
        httpStatus.forbidden,
        { message: "API rate limit exceeded" },
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(rateLimitResetSeconds),
        },
      );

      return;
    }
    if (authorisation !== `Bearer ${fixtureToken}`) {
      send(httpStatus.unauthorised, { message: "Bad credentials" });

      return;
    }
    bodyOf(request)
      .then((body) => {
        if (!isRecord(body) || !isRecord(body.variables)) {
          throw new Error("the request is not a GraphQL request");
        }
        send(httpStatus.ok, answer(stringOf(body, "query"), body.variables));
      })
      .catch((error: unknown) => {
        send(httpStatus.serverError, {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture is not listening on a port");
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}/graphql`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
};
