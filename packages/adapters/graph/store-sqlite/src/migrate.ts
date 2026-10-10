import { sql } from "drizzle-orm";
import type { MigrationMeta } from "drizzle-orm/migrator";
import { z } from "zod";
import {
  inTransaction,
  sequentially,
  type SqliteDatabase,
} from "./database.ts";
import { migrations } from "./generated/migrations.ts";

/** The journal table drizzle's own migrators keep, so a database migrated here is one drizzle-kit recognises, and the reverse. */
const journal = "__drizzle_migrations";

const appliedRow = z.tuple([z.string().nullable()]);

/** What `migrate` applies and how it stamps the journal. */
export interface MigrateOptions {
  /** The migrations to apply where missing; the package's own by default. */
  readonly migrations?: readonly MigrationMeta[];
  /** The clock that stamps each journal row's `applied_at`; the system clock by default. */
  readonly now?: () => Date;
}

/**
 * Brings a database up to the package's schema by applying, in one transaction, every embedded drizzle-kit migration its journal does not name, and recording each in drizzle's `__drizzle_migrations` journal with the name, hash and folder time drizzle's own migrators record. A migration is matched by name, as drizzle's `getMigrationsToRun` matches it.
 *
 * Drizzle's migrators cannot serve every runtime: `drizzle-orm/migrator` reads the migrations folder through `node:fs`, and `migrateAsync` reads its journal in object mode, which the `sqlite-proxy` session refuses. This one reads the journal through `values`, which every async SQLite driver answers, and takes the migrations from the package itself, so a Node process and a browser worker apply exactly the same statements.
 * @param db - The database to migrate. The caller holds it exclusively for the duration.
 * @param options - What to apply and how to stamp it.
 */
export const migrate = async (
  db: SqliteDatabase,
  options: MigrateOptions = {},
): Promise<void> => {
  const { migrations: available = migrations, now = () => new Date() } =
    options;
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(journal)} (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
  );
  const applied = new Set(
    (await db.values(sql`SELECT name FROM ${sql.identifier(journal)}`)).map(
      (row) => appliedRow.parse(row)[0],
    ),
  );
  const pending = available.filter(({ name }) => !applied.has(name));
  if (pending.length === 0) {
    return;
  }

  await inTransaction(db, async () =>
    sequentially(
      pending
        .flatMap((migration) => [
          ...migration.sql.map((statement) => sql.raw(statement)),
          sql`INSERT INTO ${sql.identifier(journal)} ("hash", "created_at", "name", "applied_at") VALUES (${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${now().toISOString()})`,
        ])
        .map((statement) => async () => {
          await db.run(statement);
        }),
    ),
  );
};
