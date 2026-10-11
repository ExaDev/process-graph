import { gapSchema } from "@exadev/process-graph-source-contract";
import { z } from "zod";

/**
 * Where a sync stopped: the model, every scope it was asked for in order, the prefix of the source to read next, and the cursor after the last page it wrote within that source's scopes (absent to read them from the start). Everything before it is in the store, so a sync started from it reads only what is left.
 */
const checkpointSchema = z
  .strictObject({
    modelId: z.string().min(1),
    scopes: z.array(z.string().min(1)).readonly(),
    source: z.string().min(1),
    after: z.string().min(1).optional(),
  })
  .readonly();

export type SyncCheckpoint = z.infer<typeof checkpointSchema>;

/**
 * What the app remembers about a model's last sync: where it stopped, when it did not finish, and the parts of the scope the sources could not read. Kept on the device, so after a reload, or offline, the app still says the model is incomplete and offers to carry on.
 */
export const syncRecordSchema = z
  .strictObject({
    modelId: z.string().min(1),
    /** Present while the sync has more to read. */
    checkpoint: checkpointSchema.optional(),
    gaps: z.array(gapSchema).readonly(),
  })
  .readonly();

export type SyncRecord = z.infer<typeof syncRecordSchema>;
