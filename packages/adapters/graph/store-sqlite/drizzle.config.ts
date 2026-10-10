import { defineConfig } from "drizzle-kit";

/** drizzle-kit reads the one table definition and writes each migration as SQL under `drizzle/`, which is committed: once data exists, the migrations are the schema's history and cannot be rebuilt from the schema alone. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/tables.ts",
  out: "./drizzle",
});
