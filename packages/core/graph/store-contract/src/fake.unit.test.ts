import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { MessageChannel } from "node:worker_threads";
import { graphStoreConformance } from "./conformance.ts";
import type { GraphStoreClient } from "./contract.ts";
import { createFakeGraphStore } from "./fake.ts";
import { createGraphStoreRouter } from "./router.ts";

graphStoreConformance({
  name: "fake, in process",
  createClient: async () =>
    Promise.resolve({
      client: createRouterClient(
        createGraphStoreRouter(createFakeGraphStore()),
      ),
      close: async () => Promise.resolve(),
    }),
});

graphStoreConformance({
  name: "fake, over a message port",
  createClient: async () => {
    const { port1, port2 } = new MessageChannel();
    new RPCHandler(createGraphStoreRouter(createFakeGraphStore())).upgrade(
      port1,
    );
    port1.start();
    const client: GraphStoreClient = createORPCClient(
      new RPCLink({ port: port2 }),
    );
    port2.start();

    return Promise.resolve({
      client,
      close: async () => {
        port1.close();
        port2.close();

        return Promise.resolve();
      },
    });
  },
});
