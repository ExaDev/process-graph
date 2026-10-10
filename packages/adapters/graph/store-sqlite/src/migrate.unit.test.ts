import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/node-sqlite/migrator";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { migrate } from "./migrate.ts";

const migrationsFolder = join(import.meta.dirname, "..", "drizzle");
const fixedClock = () => new Date("2000-01-01T00:00:00.000Z");

const fresh = () => drizzle({ client: new DatabaseSync(":memory:") });

/** Every table and index definition of the store's schema, in a stable order, and the journal's columns, whose DDL differs only in whitespace between drizzle's migrators and this one. */
const schemaOf = (db: ReturnType<typeof fresh>) => ({
  definitions: db.values(
    sql`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY type, name`,
  ),
  journal: db.values(
    sql`SELECT name, type, "notnull", pk FROM pragma_table_info('__drizzle_migrations') ORDER BY cid`,
  ),
});

/** What each journal row records about its migration, leaving out when it was applied. */
const journalOf = (db: ReturnType<typeof fresh>) =>
  db.values(
    sql`SELECT name, hash, created_at FROM __drizzle_migrations ORDER BY id`,
  );

describe("migrate", () => {
  test("builds the same schema and journal as drizzle's own node-sqlite migrator from the committed folder", async () => {
    const theirs = fresh();
    drizzleMigrate(theirs, { migrationsFolder });
    const ours = fresh();
    await migrate(ours, { now: fixedClock });

    expect(schemaOf(ours)).toEqual(schemaOf(theirs));
    expect(journalOf(ours)).toEqual(journalOf(theirs));
    expect(journalOf(ours).length).toBeGreaterThan(0);
  });

  test("applies nothing a second time, and drizzle's migrator finds nothing left to apply after it", async () => {
    const db = fresh();
    await migrate(db, { now: fixedClock });
    const journal = journalOf(db);

    await migrate(db, { now: fixedClock });
    drizzleMigrate(db, { migrationsFolder });

    expect(journalOf(db)).toEqual(journal);
  });

  test("applies only what drizzle's migrator left out", async () => {
    const db = fresh();
    drizzleMigrate(db, { migrationsFolder });
    const journal = journalOf(db);

    await migrate(db, { now: fixedClock });

    expect(journalOf(db)).toEqual(journal);
  });
});
