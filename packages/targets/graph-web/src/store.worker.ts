import { serveGraphStoreInWorker } from "@exadev/process-graph-sqlite-wasm/worker";

/** The one database the app keeps on this origin. Every tab's worker serves it under this name, so they share it under its Web Lock and hear each other's changes. */
serveGraphStoreInWorker({ name: "process-graph" });
