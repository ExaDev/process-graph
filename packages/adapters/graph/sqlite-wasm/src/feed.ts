import {
  ChangeFeed,
  storeChangeSchema,
  type StoreChange,
} from "@exadev/process-graph-store-contract";

/**
 * A change feed shared by every worker serving the same database in this origin: each change committed here is published locally and posted on a `BroadcastChannel`, and each change another worker posts there is published locally. Every tab's subscribers therefore hear every tab's writes.
 */
export class BroadcastChangeFeed extends ChangeFeed {
  readonly #channel: BroadcastChannel;

  /**
   * @param name - The channel name, one per database, so two databases in one origin do not hear each other.
   */
  constructor(name: string) {
    super();
    this.#channel = new BroadcastChannel(name);
    this.#channel.addEventListener("message", (event: MessageEvent) => {
      const parsed = storeChangeSchema.safeParse(event.data);
      if (parsed.success) {
        super.publish(parsed.data);
      }
    });
  }

  /**
   * Publishes a change committed in this worker, here and to every other worker on the channel.
   * @param change - The committed change.
   */
  override publish(change: StoreChange): void {
    super.publish(change);
    this.#channel.postMessage(change);
  }

  /** Stops hearing and posting changes. */
  close(): void {
    this.#channel.close();
  }
}
