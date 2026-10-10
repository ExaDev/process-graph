import { readFileSync } from "node:fs";
import { githubGraphqlEndpoint, type GraphqlFetch } from "../graphql.ts";
import {
  graphqlRequestOf,
  type Recording,
  recordingSchema,
  requestKey,
} from "./recording.ts";

/**
 * Loads a recorded fixture from `fixtures/`.
 * @param name - The fixture's file name without `.json`.
 * @returns The recording.
 */
export const loadRecording = (name: string): Recording =>
  recordingSchema.parse(
    JSON.parse(
      readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"),
    ),
  );

/**
 * A fetch that answers from a recording. A request that was not recorded fails the test with its operation and variables, never reaching the network; an aborted signal rejects as fetch does.
 * @param recording - The exchanges to answer from.
 * @returns The fetch, and the requests it has answered, in order.
 */
export const replayFetch = (
  recording: Readonly<Recording>,
): { readonly fetch: GraphqlFetch; readonly requests: readonly string[] } => {
  const responses = new Map(
    recording.exchanges.map((exchange) => [
      requestKey(exchange.request),
      exchange.response,
    ]),
  );
  const requests: string[] = [];

  const replay = async (url: string, init: RequestInit): Promise<Response> => {
    init.signal?.throwIfAborted();
    if (url !== githubGraphqlEndpoint) {
      throw new Error(
        `expected a request to ${githubGraphqlEndpoint}, not ${url}`,
      );
    }
    const request = graphqlRequestOf(init.body);
    const key = requestKey(request);
    const response = responses.get(key);
    if (response === undefined) {
      throw new Error(`no recorded response for ${key}`);
    }
    requests.push(key);

    return Promise.resolve(
      new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  return { fetch: replay, requests };
};
