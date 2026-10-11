/**
 * The SQLite graph store on Node's built-in `node:sqlite`, through `drizzle-orm/node-sqlite`: the driver for the command line and for servers. `openNodeGraphStore` opens (and on first use migrates) a database file and returns the `GraphStore` to serve with the contract's `createGraphStoreRouter`. `prepareDataFile` makes a data file private to its owner before the store opens it.
 */
export { openNodeGraphStore, type NodeGraphStore } from "./open.ts";
export {
  prepareDataFile,
  privateDirectoryMode,
  privateFileMode,
  type DataFileOptions,
} from "./data-file.ts";
