import { sql } from "drizzle-orm";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";

/**
 * Any Drizzle SQLite database: the async drivers (`sqlite-proxy`, libSQL) and the synchronous ones Drizzle wraps in the same async API (`node-sqlite`, `better-sqlite3`). The store awaits every result, which covers both.
 */
export type SqliteDatabase = SQLiteAsyncDatabase<"sync" | "async", unknown>;

/**
 * Runs steps one after another, each starting once the one before has finished: the statements of one transaction, which must not overlap on a connection.
 * @param steps - The steps, in order.
 */
export const sequentially = async (
  steps: readonly (() => Promise<unknown>)[],
): Promise<void> => {
  await steps.reduce<Promise<unknown>>(async (previous, step) => {
    await previous;

    return step();
  }, Promise.resolve());
};

/**
 * Runs work inside one immediate transaction: committed when the work resolves, rolled back when it throws, and the error rethrown.
 *
 * The transaction is opened with plain statements rather than Drizzle's `transaction`, whose callback must be synchronous on a synchronous driver and asynchronous on an async one. The caller must hold the connection exclusively for the duration, so no other work interleaves between the statements.
 * @param db - The database.
 * @param work - The work to run.
 * @returns What the work returns.
 */
export const inTransaction = async <T>(
  db: SqliteDatabase,
  work: () => Promise<T>,
): Promise<T> => {
  await db.run(sql`BEGIN IMMEDIATE`);
  try {
    const result = await work();
    await db.run(sql`COMMIT`);

    return result;
  } catch (error) {
    await db.run(sql`ROLLBACK`);
    throw error;
  }
};

/**
 * Runs one store operation with the database to itself. The store calls it around every operation, read or write, so the statements of one operation never interleave with another's on the same connection.
 */
export type Exclusive = <T>(operation: () => Promise<T>) => Promise<T>;

/**
 * An `Exclusive` for one process: operations wait for the one before to settle, in call order.
 * @returns The serialiser.
 */
export const serialised = (): Exclusive => {
  let tail: Promise<unknown> = Promise.resolve();

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  };
};
