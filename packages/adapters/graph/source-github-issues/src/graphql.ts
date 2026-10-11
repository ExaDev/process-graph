import {
  GraphSourceError,
  type GapReason,
} from "@exadev/process-graph-source-contract";
import type { z } from "zod";

/** GitHub's GraphQL endpoint. */
export const githubGraphqlEndpoint = "https://api.github.com/graphql";

/**
 * Supplies the token for requests about one owner's repositories, so different organisations can use different credentials. The token is only ever sent in the `Authorization` header; this adapter never logs or returns it.
 * @param owner - The login of the account whose repositories or board the request reads, or `undefined` for a request about the token's own holder (the viewer and the organisations it belongs to), which no owner names.
 * @param signal - The caller's abort signal.
 * @returns The token.
 */
export type GitHubTokenPort = (
  owner: string | undefined,
  signal: AbortSignal | undefined,
) => Promise<string>;

/** The part of `fetch` this adapter uses: one POST to the GraphQL endpoint. The global `fetch` satisfies it. */
export type GraphqlFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/** How requests reach GitHub. `fetch` and `now` are ports, so tests replay recorded responses and fix the clock. */
export interface GraphqlTransport {
  readonly token: GitHubTokenPort;
  readonly fetch: GraphqlFetch;
  /** The current time in milliseconds since the epoch, for turning a `retry-after` delay into a reset instant. */
  readonly now: () => number;
}

/** A GraphQL error that leaves the rest of the response usable: part of what was asked for does not exist or is not visible to the token. */
export interface Problem {
  readonly reason: GapReason;
  readonly message: string;
}

/** A parsed response: its data, and the problems that nulled parts of it. */
export interface QueryResult<Data> {
  readonly data: Data;
  readonly problems: readonly Problem[];
}

const millisecondsPerSecond = 1000;

/** GraphQL error types that mean part of the data is absent rather than that the request failed. */
const problemReasons: Readonly<Record<string, GapReason>> = {
  NOT_FOUND: "not-found",
  FORBIDDEN: "forbidden",
};

interface GraphqlError {
  readonly type: string | undefined;
  readonly message: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The `errors` entries of a GraphQL response body, each with its `type` when GitHub gave one. */
const errorsOf = (body: unknown): readonly GraphqlError[] => {
  if (!isRecord(body) || !Array.isArray(body.errors)) {
    return [];
  }
  const entries: readonly unknown[] = body.errors;

  return entries.filter(isRecord).map((entry) => ({
    type: typeof entry.type === "string" ? entry.type : undefined,
    message:
      typeof entry.message === "string" ? entry.message : "no message given",
  }));
};

/** The `message` of a REST-style error body, which GitHub sends for HTTP-level refusals. */
const messageOf = (body: unknown): string | undefined =>
  isRecord(body) && typeof body.message === "string" ? body.message : undefined;

/**
 * When GitHub says its limit resets: `x-ratelimit-reset` (epoch seconds) for the primary limit, `retry-after` (seconds from now) for a secondary limit. `undefined` when it gives neither.
 */
const resetAtOf = (
  headers: Readonly<Headers>,
  now: number,
): string | undefined => {
  const reset = headers.get("x-ratelimit-reset");
  if (reset !== null && /^\d+$/u.test(reset)) {
    return new Date(Number(reset) * millisecondsPerSecond).toISOString();
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null && /^\d+$/u.test(retryAfter)) {
    return new Date(
      now + Number(retryAfter) * millisecondsPerSecond,
    ).toISOString();
  }

  return undefined;
};

/**
 * Whether a response is GitHub refusing for rate limiting: HTTP 429; HTTP 403 with no requests remaining or naming a secondary rate limit; or a `RATE_LIMITED` GraphQL error, which GitHub sends with HTTP 200.
 */
const isRateLimited = (
  response: Response,
  body: unknown,
  errors: readonly GraphqlError[],
): boolean => {
  const tooManyRequests = 429;
  const forbidden = 403;
  if (response.status === tooManyRequests) {
    return true;
  }
  if (errors.some((error) => error.type === "RATE_LIMITED")) {
    return true;
  }

  const message = messageOf(body);

  return (
    response.status === forbidden &&
    (response.headers.get("x-ratelimit-remaining") === "0" ||
      (message !== undefined && /secondary rate limit/iu.test(message)))
  );
};

/** Reads a response body as JSON, failing loudly when it is not. */
const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    throw new Error(
      `GitHub answered HTTP ${String(response.status)} with a body that is not JSON`,
    );
  }
};

/** One GraphQL request. */
export interface GraphqlRequest<Schema extends z.ZodType> {
  /** The GraphQL document. */
  readonly query: string;
  /** Its variables. */
  readonly variables: Readonly<Record<string, unknown>>;
  /** The login whose token authorises the request, or `undefined` for a request about the token's own holder. */
  readonly owner: string | undefined;
  /** The schema `data` must match. */
  readonly schema: Schema;
}

/**
 * Sends one GraphQL request and classifies the answer.
 * @param transport - The token, fetch and clock ports.
 * @param request - The document, its variables, the owner whose token to use and the schema for `data`.
 * @param signal - The caller's abort signal, passed to `fetch`.
 * @returns The parsed data and any `NOT_FOUND` or `FORBIDDEN` problems beside it.
 * @throws GraphSourceError with `unauthorised` for HTTP 401, and `rate-limited` (with the reset instant when GitHub gives one) for any form of rate limiting.
 * @throws Error for any other failure: an HTTP error, another GraphQL error type, or data that does not match the schema.
 */
export const graphql = async <Schema extends z.ZodType>(
  transport: GraphqlTransport,
  request: GraphqlRequest<Schema>,
  signal: AbortSignal | undefined,
): Promise<QueryResult<z.infer<Schema>>> => {
  const token = await transport.token(request.owner, signal);
  const response = await transport.fetch(githubGraphqlEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: request.query,
      variables: request.variables,
    }),
    signal: signal ?? null,
  });
  const body = await readJson(response);
  const errors = errorsOf(body);
  const unauthorised = 401;

  if (response.status === unauthorised) {
    throw new GraphSourceError({
      kind: "unauthorised",
      message: `GitHub rejected the token${request.owner === undefined ? "" : ` for ${request.owner}`}: ${messageOf(body) ?? "HTTP 401"}`,
    });
  }
  if (isRateLimited(response, body, errors)) {
    const resetAt = resetAtOf(response.headers, transport.now());
    throw new GraphSourceError({
      kind: "rate-limited",
      message:
        resetAt === undefined
          ? "GitHub is rate limiting requests"
          : `GitHub is rate limiting requests until ${resetAt}`,
      resetAt,
    });
  }
  if (!response.ok) {
    throw new Error(
      `GitHub answered HTTP ${String(response.status)}: ${messageOf(body) ?? "no message given"}`,
    );
  }
  const problems = errors.map((error) => {
    const reason =
      error.type === undefined ? undefined : problemReasons[error.type];
    if (reason === undefined) {
      throw new Error(
        `GitHub GraphQL error${error.type === undefined ? "" : ` ${error.type}`}: ${error.message}`,
      );
    }

    return { reason, message: error.message };
  });
  const data = request.schema.safeParse(isRecord(body) ? body.data : undefined);
  if (!data.success) {
    throw new Error(
      `GitHub's response does not have the expected shape: ${data.error.message}`,
    );
  }

  return { data: data.data, problems };
};
