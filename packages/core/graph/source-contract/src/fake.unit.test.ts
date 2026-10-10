import { describe, expect, test } from "vitest";
import { graphSourceConformance } from "./conformance.ts";
import { createFakeGraphSource } from "./fake.ts";
import { createGraphSourceRouter } from "./router.ts";
import { fakeOptions } from "./test-support/pages.ts";
import {
  inProcessClient,
  messagePortClient,
} from "./test-support/transports.ts";

const router = createGraphSourceRouter(createFakeGraphSource(fakeOptions));
const scope = ["fake:acme/alpha", "fake:acme/beta"];

graphSourceConformance({
  name: "in-memory fake, in process",
  createClient: () => inProcessClient(router),
  scope,
  missingScope: "fake:acme/gamma",
  malformedScope: "other:acme/alpha",
});

graphSourceConformance({
  name: "in-memory fake, over a message port",
  createClient: () => messagePortClient(router),
  scope,
  missingScope: "fake:acme/gamma",
  malformedScope: "fake:",
});

describe("createFakeGraphSource", () => {
  test("serves the scopes in the order requested, one page per call", async () => {
    const client = inProcessClient(router);
    const first = await client.v1.sync.page({
      scope: ["fake:acme/beta", "fake:acme/alpha"],
    });
    expect(first.activities.map((activity) => activity.id)).toEqual([
      "fake:acme/beta#1",
      "fake:acme/alpha#2",
    ]);
    expect(first.next).toBe("fake%3Aacme%2Fbeta@0");
  });

  test("a repeated scope identifier is read once", async () => {
    const client = inProcessClient(router);
    const only = await client.v1.sync.page({
      scope: ["fake:acme/beta", "fake:acme/beta"],
    });
    expect(only.next).toBeUndefined();
  });

  test("a known scope with no pages answers with one empty page", async () => {
    const client = inProcessClient(
      createGraphSourceRouter(
        createFakeGraphSource({ source: "fake", scopes: { "fake:empty": [] } }),
      ),
    );
    await expect(
      client.v1.sync.page({ scope: ["fake:empty"] }),
    ).resolves.toEqual({
      participants: [],
      activities: [],
      transitions: [],
      relations: [],
      overlay: {},
      gaps: [],
    });
  });

  test("the last page's position is not a cursor it accepts", async () => {
    const client = inProcessClient(router);
    await expect(
      client.v1.sync.page({
        scope: ["fake:acme/beta"],
        after: "fake%3Aacme%2Fbeta@0",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "invalid-cursor", value: "fake%3Aacme%2Fbeta@0" },
    });
  });

  test("describe names the source", async () => {
    await expect(inProcessClient(router).v1.describe()).resolves.toEqual({
      source: "fake",
    });
  });
});
