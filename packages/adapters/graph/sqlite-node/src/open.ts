import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import type { GraphStore } from "@exadev/process-graph-store-contract";
import { createSqliteGraphStore } from "@exadev/process-graph-store-sqlite";
import { sql } from "drizzle-orm";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

/** An open store and the handles behind it. */
export interface NodeGraphStore {
  /** The store, to serve with `createGraphStoreRouter`. */
  readonly store: GraphStore;
  /** The Drizzle database the store runs on, for tools that read the tables directly. */
  readonly db: NodeSQLiteDatabase;
  /** Closes the database. The store must not be used afterwards. */
  readonly close: () => void;
}

/** The path `node:sqlite` reads as a private database in memory rather than a file. */
const inMemory = ":memory:";

/**
 * Opens a graph store on a SQLite database file, creating the file when it does not exist. The schema is migrated on the store's first operation.
 *
 * A file database is switched to write-ahead logging, so readers in other processes (a command line beside a server) are not blocked by a writer. Each process's change feed sees only its own writes.
 * @param path - The database file, or `":memory:"` for a private database that lives as long as the store.
 * @param options - `node:sqlite` options passed through unchanged, such as `timeout` for how long a write waits for another process's lock.
 * @returns The store, its database and a way to close it.
 */
export const openNodeGraphStore = (
  path: string,
  options: DatabaseSyncOptions = {},
): NodeGraphStore => {
  const client = new DatabaseSync(path, options);
  const db = drizzle({ client });
  if (path !== inMemory) {
    db.run(sql`PRAGMA journal_mode = WAL`);
  }

  return {
    store: createSqliteGraphStore({ db }),
    db,
    close: () => {
      client.close();
    },
  };
};
