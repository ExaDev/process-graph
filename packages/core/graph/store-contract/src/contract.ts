import { type ContractRouterClient, eventIterator, oc } from "@orpc/contract";
import { modelSchema, overlaySchema } from "@exadev/process-graph-schema";
import { z } from "zod";
import {
  boundItemsSchema,
  issueSchema,
  modelIdSchema,
  modelSummarySchema,
  reachSchema,
  revisionSchema,
  storedModelSchema,
  storeChangeSchema,
} from "./schema.ts";

/**
 * The typed errors a procedure can end with, each carrying its detail as data. The codes are oRPC's common codes, so an HTTP transport answers with the matching status (404, 422) without any per-transport mapping.
 */
const graphStoreErrors = {
  NOT_FOUND: {
    message: "No such model, or no such element in it.",
    data: z.strictObject({
      modelId: z.string(),
      element: z.string().exactOptional(),
    }),
  },
  UNPROCESSABLE_CONTENT: {
    message: "The change would leave the model or its overlay invalid.",
    data: z.strictObject({ issues: z.array(issueSchema).readonly() }),
  },
};

const modelRef = z.strictObject({ modelId: modelIdSchema }).readonly();
const elementRef = z
  .strictObject({ modelId: modelIdSchema, element: z.string() })
  .readonly();
const written = z.strictObject({ revision: revisionSchema }).readonly();

/**
 * Version 1 of the `GraphStore` port. A breaking change adds a sibling `v2` beside it, so one server can serve both while clients move across.
 *
 * - `models.list`, `models.save`, `models.load` and `models.delete` keep whole models. A save replaces the model and drops the run state of elements it no longer declares.
 * - `overlay.set` sets the run state of the elements it names.
 * - `items.upsert` merges items read from a source into a model by identifier, creating the model when it does not exist.
 * - `query.ready`, `query.blockedChain` and `query.impact` answer structural questions from the stored transitions and run state alone (see the package README for exactly what they read), so a store can answer them without loading the model or evaluating conditions.
 * - `changes` yields every later change to one model as an event iterator.
 *
 * Every write is atomic and checked: a change that would leave the model or overlay invalid (`validate`, `validateOverlay`) is rejected whole with `UNPROCESSABLE_CONTENT`. Every call takes the caller's abort signal through the oRPC client options; a call aborted before it writes leaves the store unchanged.
 */
const graphStoreV1Contract = oc.errors(graphStoreErrors).router({
  models: {
    list: oc.output(z.array(modelSummarySchema).readonly()),
    save: oc
      .input(
        z
          .strictObject({ modelId: modelIdSchema, model: modelSchema })
          .readonly(),
      )
      .output(written),
    load: oc.input(modelRef).output(storedModelSchema),
    delete: oc.input(modelRef).output(
      z.union([
        z
          .strictObject({
            deleted: z.literal(true),
            revision: revisionSchema,
          })
          .readonly(),
        z.strictObject({ deleted: z.literal(false) }).readonly(),
      ]),
    ),
  },
  overlay: {
    set: oc
      .input(
        z
          .strictObject({ modelId: modelIdSchema, overlay: overlaySchema })
          .readonly(),
      )
      .output(written),
  },
  items: {
    upsert: oc
      .input(
        z
          .strictObject({ modelId: modelIdSchema, items: boundItemsSchema })
          .readonly(),
      )
      .output(written),
  },
  query: {
    ready: oc
      .input(modelRef)
      .output(
        z.strictObject({ elements: z.array(z.string()).readonly() }).readonly(),
      ),
    blockedChain: oc
      .input(elementRef)
      .output(
        z.strictObject({ chain: z.array(reachSchema).readonly() }).readonly(),
      ),
    impact: oc
      .input(elementRef)
      .output(
        z
          .strictObject({ impacted: z.array(reachSchema).readonly() })
          .readonly(),
      ),
  },
  changes: oc
    .input(
      z
        .strictObject({
          modelId: modelIdSchema,
          since: revisionSchema.exactOptional(),
        })
        .readonly(),
    )
    .output(eventIterator(storeChangeSchema)),
});

/** The `GraphStore` port: an oRPC router contract, keyed by version. */
export const graphStoreContract = { v1: graphStoreV1Contract };

/** A client for the `GraphStore` port over any transport: an in-process router client or one built on an oRPC link. */
export type GraphStoreClient = ContractRouterClient<typeof graphStoreContract>;
