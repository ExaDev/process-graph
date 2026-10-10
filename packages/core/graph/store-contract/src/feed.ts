import type { StoreChange } from "./schema.ts";

/** A live subscription to one model's changes. Iterate it to receive them; `close` ends it. */
export interface ChangeSubscription extends AsyncIterable<StoreChange> {
  /** Stops delivery and ends the iteration. Idempotent. */
  readonly close: () => void;
}

/**
 * Fans the changes one store makes out to every subscriber of the model they touch. A store publishes after each committed write; the router reads a subscription for `changes`.
 *
 * A subscription buffers changes that arrive while its consumer is busy, so none is dropped between two pulls, and it is registered the moment `subscribe` returns, so a caller can subscribe first and then read the current revision without missing a change made in between.
 *
 * A feed only sees the writes made through the store that owns it. Several processes or tabs writing to one database each need their own bridge (a `BroadcastChannel`, a database notification) that publishes the others' changes into their feed.
 */
export class ChangeFeed {
  readonly #listeners = new Map<string, Set<(change: StoreChange) => void>>();

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
   * @param signal - Ends the subscription when it fires.
   * @returns The live subscription.
   */
  subscribe(modelId: string, signal?: AbortSignal): ChangeSubscription {
    const buffered: StoreChange[] = [];
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
        buffered.push(change);
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
        const change = buffered.shift();
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
