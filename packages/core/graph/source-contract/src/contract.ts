import {
  type ContractRouterClient,
  eventIterator,
  type InitialInputSchema,
  oc,
  type ProcedureContract,
  type RouterContract,
} from "@orpc/contract";
import { z } from "zod";
import {
  badRequestReasons,
  sourceDescriptionSchema,
  syncInputSchema,
  syncPageSchema,
  type SyncPage,
  type SyncPageInput,
} from "./schema.ts";

/**
 * The typed errors every procedure can end with, each carrying its detail as data. The codes are oRPC's common codes, so an HTTP transport answers with the matching status (401, 429, 400) without any per-transport mapping.
 */
const graphSourceErrors = {
  UNAUTHORIZED: {
    message: "The source rejected the credentials.",
    data: z.strictObject({}),
  },
  TOO_MANY_REQUESTS: {
    message: "The source is rate limiting requests.",
    data: z.strictObject({ resetAt: z.iso.datetime().optional() }),
  },
  BAD_REQUEST: {
    message: "The cursor or a scope identifier is not valid for this source.",
    data: z.strictObject({
      reason: z.enum(badRequestReasons),
      value: z.string(),
    }),
  },
};

type GraphSourceErrors = typeof graphSourceErrors;

/** The event iterator of pages `sync.stream` returns, typed by name so declarations stay small. */
const syncPageEvents: ReturnType<
  typeof eventIterator<SyncPageInput, SyncPage>
> = eventIterator(syncPageSchema);

/**
 * The shape of version 1, stated so the published declarations name the page and input schemas rather than expanding them into every procedure.
 */
interface GraphSourceV1Contract {
  /** Present so the contract is assignable to oRPC's `RouterContract`, which is an index-signature type. */
  readonly [key: string]: RouterContract;
  readonly describe: ProcedureContract<
    InitialInputSchema,
    typeof sourceDescriptionSchema,
    GraphSourceErrors
  >;
  readonly sync: {
    readonly page: ProcedureContract<
      typeof syncInputSchema,
      typeof syncPageSchema,
      GraphSourceErrors
    >;
    readonly stream: ProcedureContract<
      typeof syncInputSchema,
      typeof syncPageEvents,
      GraphSourceErrors
    >;
  };
}

/**
 * Version 1 of the `GraphSource` port. A breaking change adds a sibling `v2` beside it, so one server can serve both while clients move across.
 *
 * - `describe` names the source, which is the prefix of every identifier it emits.
 * - `sync.page` returns one page of the scope, starting after `after` when given.
 * - `sync.stream` yields every page from `after` onwards (or from the start) as an event iterator, each carrying the `next` cursor to resume after it. Pages are produced on demand as the consumer pulls, so a slow consumer applies backpressure. Over an event-stream transport each event's id is its `next` cursor, so a reconnecting client's `lastEventId` resumes there too; an explicit `after` takes precedence.
 *
 * Every call takes the caller's abort signal through the oRPC client options, and every implementation passes it on to its source.
 */
const graphSourceV1Contract: GraphSourceV1Contract = oc
  .errors(graphSourceErrors)
  .router({
    describe: oc.output(sourceDescriptionSchema),
    sync: {
      page: oc.input(syncInputSchema).output(syncPageSchema),
      stream: oc.input(syncInputSchema).output(syncPageEvents),
    },
  });

/** The `GraphSource` port: an oRPC router contract, keyed by version. */
export const graphSourceContract: {
  readonly v1: GraphSourceV1Contract;
} = { v1: graphSourceV1Contract };

/** A client for the `GraphSource` port over any transport: an in-process router client or one built on an oRPC link. */
export type GraphSourceClient = ContractRouterClient<
  typeof graphSourceContract
>;
