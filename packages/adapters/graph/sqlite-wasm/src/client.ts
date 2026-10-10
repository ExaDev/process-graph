import type { GraphStoreClient } from "@exadev/process-graph-store-contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";

/**
 * A client for the graph store a worker serves with `serveGraphStoreInWorker`. Every procedure of the contract is available, with its abort signal and typed errors, as if the store were in the page.
 * @param worker - The dedicated worker running the store.
 * @returns The store's oRPC client.
 */
export const connectGraphStore = (worker: Readonly<Worker>): GraphStoreClient =>
  createORPCClient(new RPCLink({ port: worker }));
