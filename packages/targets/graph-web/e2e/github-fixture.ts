import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for GitHub's GraphQL API, served on a local port for the end-to-end tests. It answers the three operations the GitHub issues source sends (`OwnerRepositories`, `RepositoryIssues` and `IssueConnection`) from a fixed set of issues, with the response shapes GitHub gives, and the same refusals: HTTP 401 for a token it does not know, and HTTP 403 with no requests remaining for the rate-limited token. CORS headers are the ones api.github.com sends, so a browser reads the rate limit headers as it would from GitHub.
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
}

/** The accounts the fixture knows, and the repositories each owns, by name. */
const accounts: Readonly<
  Record<
    string,
    { readonly type: AccountType; readonly repositories: readonly string[] }
  >
> = {
  acme: { type: "Organization", repositories: ["api", "web"] },
  partner: { type: "Organization", repositories: ["sdk"] },
  alice: { type: "User", repositories: [] },
};

/**
 * The issues. `acme` holds the work: a schema, the endpoint on it, the page on the endpoint and the release on the page. The page also waits on an SDK in another organisation's repository, so a sync of `acme` follows that dependency across organisations into `partner/sdk`, which is outside the scope.
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

const refOf = (owner: string, repository: string, number: number) => {
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

  return {
    number,
    title: issue.title,
    state: issue.state,
    repository: { name: repository, owner: ownerOf(owner) },
  };
};

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

const answer = (
  query: string,
  variables: Readonly<Record<string, unknown>>,
): Answer => {
  if (query.includes("query OwnerRepositories")) {
    const login = stringOf(variables, "login");
    const account = accounts[login];
    if (account === undefined) {
      return {
        data: { repositoryOwner: null },
        errors: [
          {
            type: "NOT_FOUND",
            message: `Could not resolve to a RepositoryOwner with the login of '${login}'.`,
          },
        ],
      };
    }

    return {
      data: {
        repositoryOwner: {
          ...ownerOf(login),
          repositories: connection(
            account.repositories.map((name) => ({ name })),
          ),
        },
      },
    };
  }
  if (query.includes("query RepositoryIssues")) {
    const owner = stringOf(variables, "owner");
    const name = stringOf(variables, "name");
    if (accounts[owner]?.repositories.includes(name) !== true) {
      return {
        data: { repository: null },
        errors: [
          {
            type: "NOT_FOUND",
            message: `Could not resolve to a Repository with the name '${owner}/${name}'.`,
          },
        ],
      };
    }
    const issues = fixtureIssues
      .filter((issue) => issue.owner === owner && issue.repository === name)
      .map((issue) => ({
        ...refOf(issue.owner, issue.repository, issue.number),
        assignees: connection(issue.assignees.map((login) => ({ login }))),
        blockedBy: connection(
          issue.blockedBy.map(([blockerOwner, repository, number]) =>
            refOf(blockerOwner, repository, number),
          ),
        ),
        subIssues: connection([]),
      }));

    return {
      data: {
        repository: { name, owner: ownerOf(owner), issues: connection(issues) },
      },
    };
  }
  throw new Error(
    "the fixture answers only the GitHub issues source's queries",
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
