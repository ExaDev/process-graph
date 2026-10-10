/**
 * The SQLite graph store on Node's built-in `node:sqlite`, through `drizzle-orm/node-sqlite`: the driver for the command line and for servers. `openNodeGraphStore` opens (and on first use migrates) a database file and returns the `GraphStore` to serve with the contract's `createGraphStoreRouter`.
 */
export { openNodeGraphStore, type NodeGraphStore } from "./open.ts";
