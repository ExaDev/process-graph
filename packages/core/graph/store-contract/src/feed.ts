import type { StoreChange } from "./schema.ts";

/** A live subscription to one model's changes. Iterate it to receive them; `close` ends it. */
export interface ChangeSubscription extends AsyncIterable<StoreChange> {
  /** Stops delivery and ends the iteration. Idempotent. */
  readonly close: () => void;
}

/**
 * How many undelivered changes a subscription holds by default before it collapses them into `missed`.
 *
 * A change tells a subscriber only that its model has moved on to a later revision, and the one thing a subscriber can do about it is read the model again. A subscriber that has not yet taken one pending change will read the model after that change, and the model it reads already reflects every later one, so a second pending change gives it nothing it could act on: one held change is all a lagging subscriber can use. A subscriber that is waiting when a change commits receives it directly and never touches the buffer, so a subscriber that keeps reading misses nothing at this capacity.
 */
export const defaultSubscriptionCapacity = 1;

/** Options for one subscription. */
export interface SubscribeOptions {
  /** Ends the subscription when it fires. */
  readonly signal?: AbortSignal | undefined;
  /** Overrides the feed's capacity for this subscription; see `ChangeFeedOptions.capacity`. */
  readonly capacity?: number;
}

/** Options for a feed. */
export interface ChangeFeedOptions {
  /**
   * The most undelivered changes a subscription holds; `defaultSubscriptionCapacity` when absent. When a change arrives and the subscription already holds this many, every held change is dropped and replaced by one `missed` event, so the buffer never grows past the capacity and the subscriber knows to load the model again. A positive integer.
   */
  readonly capacity?: number;
}

/** Checks a capacity is a positive integer, since a subscription must be able to hold the `missed` it reports. */
const checkedCapacity = (capacity: number): number => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(
      `A subscription capacity must be a positive integer, not ${capacity}`,
    );
  }

  return capacity;
};

/**
 * Fans the changes one store makes out to every subscriber of the model they touch. A store publishes after each committed write; the router reads a subscription for `changes`.
 *
 * A subscription is registered the moment `subscribe` returns, so a caller can subscribe first and then read the current revision without missing a change made in between. A change that arrives while the subscriber is waiting is handed straight to it; one that arrives while it is busy is held, up to the subscription's capacity. Past that, the held changes are replaced by a single `missed` event: memory stays bounded however slowly a subscriber reads, and a subscriber is never left unaware that it fell behind.
 *
 * A feed only sees the writes made through the store that owns it. Several processes or tabs writing to one database each need their own bridge (a `BroadcastChannel`, a database notification) that publishes the others' changes into their feed.
 */
export class ChangeFeed {
  readonly #listeners = new Map<string, Set<(change: StoreChange) => void>>();

  readonly #capacity: number;

  /**
   * @param options - The capacity every subscription gets unless it sets its own.
   * @throws RangeError when the capacity is not a positive integer.
   */
  constructor(options: ChangeFeedOptions = {}) {
    this.#capacity = checkedCapacity(
      options.capacity ?? defaultSubscriptionCapacity,
    );
  }

  /**
   * Delivers a change to every current subscriber of its model.
   * @param change - The change, after it is committed.
   */
  publish(change: StoreChange): void {
    for (const listener of this.#listeners.get(change.modelId) ?? []) {
      listener(change);
    }
  }

  /**
   * Subscribes to one model's changes from now on.
   * @param modelId - The model to follow.
   * @param options - The signal that ends it, and a capacity overriding the feed's.
   * @returns The live subscription.
   * @throws RangeError when the capacity is not a positive integer.
   */
  subscribe(
    modelId: string,
    options: SubscribeOptions = {},
  ): ChangeSubscription {
    const { signal } = options;
    const capacity = checkedCapacity(options.capacity ?? this.#capacity);
    let buffered: StoreChange[] = [];
    // The pull waiting for the next change, when the buffer was empty as it asked.
    let waiting:
      ((result: IteratorResult<StoreChange, undefined>) => void) | undefined;
    let closed = false;
    const listeners = this.#listeners.get(modelId) ?? new Set();
    this.#listeners.set(modelId, listeners);
    const finished: IteratorResult<StoreChange, undefined> = {
      done: true,
      value: undefined,
    };

    const listener = (change: StoreChange): void => {
      if (waiting === undefined) {
        buffered =
          buffered.length < capacity
            ? [...buffered, change]
            : [{ modelId, kind: "missed" }];
      } else {
        waiting({ done: false, value: change });
        waiting = undefined;
      }
    };
    const close = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(modelId);
      }
      signal?.removeEventListener("abort", close);
      waiting?.(finished);
      waiting = undefined;
    };
    listeners.add(listener);
    signal?.addEventListener("abort", close);
    if (signal?.aborted === true) {
      close();
    }

    const iterator: AsyncIterator<StoreChange, undefined> = {
      next: async () => {
        const [change, ...rest] = buffered;
        buffered = rest;
        if (change !== undefined) {
          return { done: false, value: change };
        }
        if (closed) {
          return finished;
        }

        return new Promise((resolve) => {
          waiting = resolve;
        });
      },
      return: async () => {
        close();

        return Promise.resolve(finished);
      },
    };

    return {
      close,
      [Symbol.asyncIterator]: () => iterator,
    };
  }
}
