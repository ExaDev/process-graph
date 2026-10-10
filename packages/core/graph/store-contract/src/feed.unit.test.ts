import { describe, expect, test } from "vitest";
import { ChangeFeed } from "./feed.ts";
import type { StoreChange } from "./schema.ts";

const saved = (modelId: string, revision: number) =>
  ({ modelId, kind: "saved", revision }) as const;

describe("ChangeFeed", () => {
  test("buffers changes published before the subscriber pulls, in order", async () => {
    // Room for both changes this subscriber is sent, so the test is about order, not capacity.
    const feed = new ChangeFeed({ capacity: 2 });
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
      .subscribe("m", { signal: controller.signal })
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
    const subscription = feed.subscribe("m", { signal: controller.signal });
    feed.publish(saved("m", 1));

    await expect(subscription[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});

describe("ChangeFeed capacity", () => {
  const capacity = 3;
  /** Enough writes to overflow the buffer more than once. */
  const writes = capacity + capacity + 1;

  /** Publishes `count` changes to a subscriber that reads nothing, then reads everything it held. */
  const heldAfter = async (count: number) => {
    const feed = new ChangeFeed({ capacity });
    const subscription = feed.subscribe("m");
    for (let revision = 1; revision <= count; revision += 1) {
      feed.publish(saved("m", revision));
    }
    subscription.close();
    const held = [];
    for await (const change of subscription) {
      held.push(change);
    }

    return held;
  };

  test("a subscriber that reads nothing never holds more than its capacity, and is told it missed changes once it overflows", async () => {
    const counts = Array.from({ length: writes }, (_, index) => index + 1);
    const helds = await Promise.all(counts.map(heldAfter));

    for (const [index, held] of helds.entries()) {
      const count = index + 1;
      expect(held.length).toBeLessThanOrEqual(capacity);
      expect(count > capacity ? held[0] : held).toEqual(
        count > capacity
          ? { modelId: "m", kind: "missed" }
          : counts.slice(0, count).map((revision) => saved("m", revision)),
      );
    }
  });

  test("after a missed, the changes that follow are delivered in order", async () => {
    const held = await heldAfter(capacity + 2);

    expect(held).toEqual([
      { modelId: "m", kind: "missed" },
      saved("m", capacity + 2),
    ]);
  });

  test("a subscriber that keeps reading misses nothing, however many changes are published", async () => {
    const feed = new ChangeFeed({ capacity: 1 });
    const iterator = feed.subscribe("m")[Symbol.asyncIterator]();
    // Each change is published while the subscriber waits for it, then taken before the next is published.
    const received = await Array.from(
      { length: writes },
      (_, index) => index + 1,
    ).reduce<Promise<readonly (StoreChange | undefined)[]>>(
      async (done, revision) => {
        const taken = await done;
        const next = iterator.next();
        feed.publish(saved("m", revision));

        const result = await next;

        return [...taken, result.done === true ? undefined : result.value];
      },
      Promise.resolve([]),
    );

    expect(received).toEqual(
      Array.from({ length: writes }, (_, index) => saved("m", index + 1)),
    );
  });

  test("a subscription's own capacity overrides the feed's", async () => {
    const feed = new ChangeFeed({ capacity });
    const subscription = feed.subscribe("m", { capacity: 1 });
    feed.publish(saved("m", 1));
    feed.publish(saved("m", 2));
    subscription.close();
    const held = [];
    for await (const change of subscription) {
      held.push(change);
    }

    expect(held).toEqual([{ modelId: "m", kind: "missed" }]);
  });

  test.each([0, -1, Number.EPSILON, Number.NaN])(
    "refuses a capacity of %s",
    (bad) => {
      expect(() => new ChangeFeed({ capacity: bad })).toThrow(RangeError);
      expect(() => new ChangeFeed().subscribe("m", { capacity: bad })).toThrow(
        RangeError,
      );
    },
  );
});
