/**
 * The SQLite graph store in the browser. The worker module (`./worker`) serves the store from a dedicated worker over SQLite compiled to WebAssembly on the OPFS `opfs-sahpool` VFS; this entry connects a page to it.
 */
export { connectGraphStore } from "./client.ts";
