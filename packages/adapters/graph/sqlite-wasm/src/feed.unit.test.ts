import { describe, expect, test } from "vitest";
import { BroadcastChangeFeed } from "./feed.ts";

const change = { modelId: "m", kind: "saved", revision: 1 } as const;

/** Reads the next change a subscription delivers. */
const next = async (feed: BroadcastChangeFeed) =>
  feed.subscribe("m")[Symbol.asyncIterator]().next();

describe("BroadcastChangeFeed", () => {
  test("delivers a change published in one feed to the subscribers of another on the same channel", async () => {
    const name = `feed-${crypto.randomUUID()}`;
    const here = new BroadcastChangeFeed(name);
    const there = new BroadcastChangeFeed(name);
    const heard = next(there);
    here.publish(change);

    await expect(heard).resolves.toEqual({ done: false, value: change });
    here.close();
    there.close();
  });

  test("ignores a message on the channel that is not a change", async () => {
    const name = `feed-${crypto.randomUUID()}`;
    const feed = new BroadcastChangeFeed(name);
    const heard = next(feed);
    const stranger = new BroadcastChannel(name);
    stranger.postMessage({ modelId: "m", kind: "renamed" });
    new BroadcastChangeFeed(name).publish(change);

    await expect(heard).resolves.toEqual({ done: false, value: change });
    stranger.close();
    feed.close();
  });
});
