// The `process-graph/store/wasm` entry point: `connectGraphStore`, which connects a page to the store a dedicated worker serves. The worker module imports `process-graph/store/wasm/worker`; the two are apart so the page never loads SQLite's WebAssembly build.
export * from "@exadev/process-graph-sqlite-wasm";
