import { serveGraphStoreInWorker } from "../../src/worker.ts";

// The test names each worker after the database it should serve.
serveGraphStoreInWorker({ name: self.name });
