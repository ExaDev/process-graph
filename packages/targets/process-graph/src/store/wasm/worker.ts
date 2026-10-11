// The `process-graph/store/wasm/worker` entry point: `serveGraphStoreInWorker`, called once at the top level of a dedicated worker module, which serves the SQLite store over SQLite compiled to WebAssembly on the OPFS `opfs-sahpool` VFS.
export * from "@exadev/process-graph-sqlite-wasm/worker";
