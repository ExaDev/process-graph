import { describe, expect, test } from "vitest";
import { ChangeFeed } from "./feed.ts";

const saved = (modelId: string, revision: number) =>
  ({ modelId, kind: "saved", revision }) as const;

describe("ChangeFeed", () => {
  test("buffers changes published before the subscriber pulls, in order", async () => {
    const feed = new ChangeFeed();
    const subscription = feed.subscribe("m");
    const [mine, theirs, later] = ["m", "other", "m"].map((modelId, index) =>
      saved(modelId, index + 1),
    );
    for (const change of [mine, theirs, later]) {
      if (change !== undefined) {
        feed.publish(change);
      }
    }
    subscription.close();

    const received = [];
    for await (const change of subscription) {
      received.push(change);
    }

    expect(received).toEqual([mine, later]);
  });

  test("delivers a change published while the subscriber waits", async () => {
    const feed = new ChangeFeed();
    const iterator = feed.subscribe("m")[Symbol.asyncIterator]();
    const next = iterator.next();
    feed.publish(saved("m", 1));

    await expect(next).resolves.toEqual({ done: false, value: saved("m", 1) });
  });

  test("ends a waiting subscriber when its signal fires, and stops delivering to it", async () => {
    const feed = new ChangeFeed();
    const controller = new AbortController();
    const iterator = feed
      .subscribe("m", controller.signal)
      [Symbol.asyncIterator]();
    const next = iterator.next();
    controller.abort();

    await expect(next).resolves.toEqual({ done: true, value: undefined });
    feed.publish(saved("m", 1));
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  test("ends at once for a signal that has already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const feed = new ChangeFeed();
    const subscription = feed.subscribe("m", controller.signal);
    feed.publish(saved("m", 1));

    await expect(subscription[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
