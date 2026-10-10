import { z } from "zod";

/**
 * One recorded GraphQL exchange: the request's document and variables, and GitHub's status and body. No header is recorded, so neither the token sent nor anything GitHub returned about the account reaches a fixture.
 */
const exchangeSchema = z.strictObject({
  request: z.strictObject({
    query: z.string(),
    variables: z.record(z.string(), z.unknown()),
  }),
  response: z.strictObject({
    status: z.int(),
    body: z.unknown(),
  }),
});

/** A fixture file: every exchange of a recorded sync, keyed by request. */
export const recordingSchema = z.strictObject({
  exchanges: z.array(exchangeSchema),
});

export type Exchange = z.infer<typeof exchangeSchema>;
export type Recording = z.infer<typeof recordingSchema>;

/** The key a request is recorded and replayed under: its document and variables, with variable keys in sorted order. */
export const requestKey = (request: Exchange["request"]): string =>
  JSON.stringify([
    request.query,
    Object.entries(request.variables).sort(([a], [b]) => a.localeCompare(b)),
  ]);

/**
 * Reads the GraphQL document and variables out of the body this adapter sends.
 * @param body - A fetch request body.
 * @returns The request, or a thrown error when the body is not a GraphQL request.
 */
export const graphqlRequestOf = (
  body: RequestInit["body"],
): Exchange["request"] => {
  if (typeof body !== "string") {
    throw new TypeError("expected a JSON string request body");
  }

  return exchangeSchema.shape.request.parse(JSON.parse(body));
};
