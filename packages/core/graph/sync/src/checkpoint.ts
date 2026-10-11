import { syncFilterSchema } from "@exadev/process-graph-source-contract";
import { z } from "zod";

/**
 * Where a sync stopped: the model, every scope it was asked for in order, the filter it read them with, the prefix of the source to read next, and the cursor after the last page it wrote within that source's scopes (absent to read them from the start). Everything before it is in the store, so a sync started from it reads only what is left. A source's cursor is valid only with the scopes and filter it was issued for, which is why both are kept with it.
 */
export const syncCheckpointSchema = z
  .strictObject({
    modelId: z.string().min(1),
    scopes: z.array(z.string().min(1)).readonly(),
    filter: syncFilterSchema.optional(),
    source: z.string().min(1),
    after: z.string().min(1).optional(),
  })
  .readonly();

export type SyncCheckpoint = z.infer<typeof syncCheckpointSchema>;
