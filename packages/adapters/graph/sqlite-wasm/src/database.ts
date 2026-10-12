import type {
  Database,
  SAHPoolUtil,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import type { Exclusive } from "@exadev/process-graph-store-sqlite";
import { sqlJsCodecs } from "drizzle-orm/sql-js/codecs";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

/** Where the database lives: an OPFS `opfs-sahpool` pool and a file in it. */
export interface DatabaseLocation {
  /** The pool's name, which is also its OPFS directory. */
  readonly pool: string;
  /** The database file's path within the pool. */
  readonly file: string;
}

/** The database a worker serves, and the exclusivity that makes it safe to share. */
export interface WorkerDatabase {
  /** A Drizzle database whose statements run on the file this worker currently holds open. */
  readonly db: SqliteRemoteDatabase;
  /** Holds the database across every tab for one store operation. */
  readonly exclusive: Exclusive;
}

/**
 * Opens a database on the `opfs-sahpool` VFS so that any number of tabs, each with its own worker, can use it with no cross-origin isolation headers.
 *
 * A pool holds its OPFS sync access handles exclusively, so only one worker in the origin can have it open at a time. Each store operation therefore takes an exclusive Web Lock named after the pool, unpauses the pool (reacquiring its handles), opens the file, runs, then closes the file and pauses the pool (releasing them) before the lock is released. A Drizzle transaction is several statements, so the lock covers the whole store operation rather than each statement. The choice and the evidence for it are recorded in https://github.com/ExaDev/process-graph/issues/22.
 * @param sqlite3 - The SQLite module, initialising; the first operation waits for it.
 * @param location - The pool and file.
 * @returns The database and its exclusivity.
 */
export const openWorkerDatabase = (
  sqlite3: Readonly<Promise<Sqlite3Static>>,
  location: DatabaseLocation,
): WorkerDatabase => {
  // The pool, once its installation has started. It is installed inside the first operation, under the lock, because installing takes the handles another tab may hold.
  let pool: Promise<SAHPoolUtil> | undefined;
  let open: Database | undefined;

  /* The store reads through `values`, `all` and query builders, never `.get()`, so `get` is refused rather than answered: the proxy's declared result type has no way to say "no row", which Drizzle's `get` signals with a missing `rows`.
     The proxy driver decodes nothing by itself: the codecs say how SQLite's stored values become the columns' types (JSON text, booleans, timestamps). SQLite wasm answers in array mode with native JavaScript values and `Uint8Array` blobs, which is what sql.js answers with, so its codecs apply. */
  const db = drizzle(
    async (statement, params, method) => {
      if (method === "get") {
        throw new Error("The graph store's worker database does not serve get");
      }
      if (open === undefined) {
        throw new Error(
          "The database was used outside a store operation; only the store's exclusive section may run statements",
        );
      }
      const rows = open.exec(statement, {
        bind: params,
        rowMode: "array",
        returnValue: "resultRows",
      });

      return Promise.resolve({ rows });
    },
    { codecs: sqlJsCodecs },
  );

  const exclusive: Exclusive = async (operation) =>
    navigator.locks.request(location.pool, { mode: "exclusive" }, async () => {
      // Installing the pool takes its handles, so only an already installed pool needs unpausing.
      const installing = pool === undefined;
      pool ??= sqlite3.then(async (module) =>
        module.installOpfsSAHPoolVfs({ name: location.pool }),
      );
      const held = await pool;
      if (!installing) {
        await held.unpauseVfs();
      }
      open = new held.OpfsSAHPoolDb(location.file);
      try {
        return await operation();
      } finally {
        open.close();
        open = undefined;
        held.pauseVfs();
      }
    });

  return { db, exclusive };
};
