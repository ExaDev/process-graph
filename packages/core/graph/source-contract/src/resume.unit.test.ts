import { getEventMeta } from "@orpc/client";
import { describe, expect, test } from "vitest";
import type { GraphSourceClient } from "./contract.ts";
import { createFakeGraphSource } from "./fake.ts";
import { createGraphSourceRouter } from "./router.ts";
import type { SyncPage } from "./schema.ts";
import { fakeOptions } from "./test-support/pages.ts";
import { inProcessClient, messagePortClient } from "./conformance.ts";

const router = createGraphSourceRouter(createFakeGraphSource(fakeOptions));
const scope = ["fake:acme/alpha", "fake:acme/beta"];

const activityIds = (
  pages: readonly SyncPage[],
): readonly (readonly string[])[] =>
  pages.map((page) => page.activities.map((activity) => activity.id));

/** Reads the first page of a stream, then closes it, returning the page and the event id the transport delivered with it. */
const interruptAfterFirst = async (
  client: GraphSourceClient,
): Promise<{
  readonly page: SyncPage;
  readonly eventId: string | undefined;
}> => {
  const iterator = await client.v1.sync.stream({ scope });
  const first = await iterator.next();
  await iterator.return();
  if (first.done === true) {
    throw new Error("expected the stream to yield a page");
  }

  return { page: first.value, eventId: getEventMeta(first.value)?.id };
};

const drain = async (
  iterator: Readonly<AsyncIterable<SyncPage>>,
): Promise<readonly SyncPage[]> => {
  const pages: SyncPage[] = [];
  for await (const page of iterator) {
    pages.push(page);
  }

  return pages;
};

describe.each([
  ["in process", () => inProcessClient(router)],
  ["over a message port", () => messagePortClient(router)],
])("a streamed sync interrupted mid-way, %s", (_, createClient) => {
  test("carries its next cursor as the event id", async () => {
    const { page, eventId } = await interruptAfterFirst(createClient());
    expect(page.next).toBe("fake%3Aacme%2Falpha@0");
    expect(eventId).toBe(page.next);
  });

  test("resumes by the cursor in its input with exactly the remaining pages", async () => {
    const client = createClient();
    const { page } = await interruptAfterFirst(client);
    expect(activityIds([page])).toEqual([
      ["fake:acme/alpha#1", "fake:acme/alpha#2"],
    ]);
    const rest = await drain(
      await client.v1.sync.stream({ scope, after: page.next ?? "" }),
    );
    expect(activityIds(rest)).toEqual([
      ["fake:acme/alpha#3"],
      ["fake:acme/beta#1", "fake:acme/alpha#2"],
    ]);
    expect(rest.map((resumed) => resumed.next)).toEqual([
      "fake%3Aacme%2Falpha@1",
      undefined,
    ]);
    expect(rest[1]?.transitions).toEqual([
      {
        id: "fake:acme/alpha#2->fake:acme/beta#1",
        source: "fake:acme/alpha#2",
        target: "fake:acme/beta#1",
      },
    ]);
  });

  test("resumes by the transport's last event id when the input has no cursor", async () => {
    const client = createClient();
    const { eventId } = await interruptAfterFirst(client);
    const rest = await drain(
      await client.v1.sync.stream(
        { scope },
        eventId === undefined ? {} : { lastEventId: eventId },
      ),
    );
    expect(activityIds(rest)).toEqual([
      ["fake:acme/alpha#3"],
      ["fake:acme/beta#1", "fake:acme/alpha#2"],
    ]);
  });

  test("an explicit cursor in the input wins over the last event id", async () => {
    const client = createClient();
    const rest = await drain(
      await client.v1.sync.stream(
        { scope, after: "fake%3Aacme%2Falpha@1" },
        { lastEventId: "fake%3Aacme%2Falpha@0" },
      ),
    );
    expect(activityIds(rest)).toEqual([
      ["fake:acme/beta#1", "fake:acme/alpha#2"],
    ]);
  });
});
