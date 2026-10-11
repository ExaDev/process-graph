// Deliberately the built bundle's worker entry, not a workspace package: this checks that `process-graph/store/wasm/worker` is emitted and that a bundler resolves it and its SQLite wasm import as a consumer's would.
import { serveGraphStoreInWorker } from "../../dist/store/wasm/worker.js";

// The test names each worker after the database it should serve.
serveGraphStoreInWorker({ name: self.name });
