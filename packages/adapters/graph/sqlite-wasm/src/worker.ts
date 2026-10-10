import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { createGraphStoreRouter } from "@exadev/process-graph-store-contract";
import { createSqliteGraphStore } from "@exadev/process-graph-store-sqlite";
import { RPCHandler } from "@orpc/server/message-port";
import { openWorkerDatabase } from "./database.ts";
import { BroadcastChangeFeed } from "./feed.ts";

/** Which database a worker serves. */
export interface GraphStoreWorkerOptions {
  /**
   * The database's name. It names the OPFS `opfs-sahpool` pool (and so its directory), the Web Lock that serialises tabs, and the channel changes are shared on, so every worker in the origin given the same name serves the same database.
   */
  readonly name: string;
}

/**
 * Serves the graph store from inside a dedicated worker, to the page that started it, over oRPC's message-port transport. Call it once at the top level of the worker module; connect from the page with `connectGraphStore`.
 *
 * The SQLite module starts initialising at once and the first store operation waits for it. The database is opened only inside each store operation, under a Web Lock shared by every tab, so tabs take turns rather than failing; see `openWorkerDatabase`. Changes committed in any tab reach every tab's `changes` subscribers through a `BroadcastChannel`.
 * @param options - Which database to serve.
 */
export const serveGraphStoreInWorker = (
  options: GraphStoreWorkerOptions,
): void => {
  const { db, exclusive } = openWorkerDatabase(sqlite3InitModule(), {
    pool: options.name,
    file: "/graph.sqlite3",
  });
  new RPCHandler(
    createGraphStoreRouter(
      createSqliteGraphStore({
        db,
        exclusive,
        feed: new BroadcastChangeFeed(options.name),
      }),
    ),
  ).upgrade(self);
};
