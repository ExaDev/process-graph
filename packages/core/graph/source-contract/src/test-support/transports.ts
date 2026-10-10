import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { afterAll } from "vitest";
import type { GraphSourceClient } from "../contract.ts";
import type { GraphSourceRouter } from "../router.ts";

/** A client that calls the router in the same process, with no serialisation. */
export const inProcessClient = (router: GraphSourceRouter): GraphSourceClient =>
  createRouterClient(router);

/**
 * A client that reaches the router across a `MessageChannel`, serialising every call and event as a worker transport does. Each client gets its own channel; every channel is closed after the file's tests.
 */
export const messagePortClient = (
  router: GraphSourceRouter,
): GraphSourceClient => {
  const { port1, port2 } = new MessageChannel();
  new RPCHandler(router).upgrade(port1);
  port2.start();
  afterAll(() => {
    port1.close();
    port2.close();
  });

  return createORPCClient<GraphSourceClient>(new RPCLink({ port: port2 }));
};
