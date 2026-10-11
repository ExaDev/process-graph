import { gapSchema } from "@exadev/process-graph-source-contract";
import { syncCheckpointSchema } from "@exadev/process-graph-sync";
import { z } from "zod";

/**
 * What the app remembers about a model's last sync: where it stopped, when it did not finish, and the parts of the scope the sources could not read. Kept on the device, so after a reload, or offline, the app still says the model is incomplete and offers to carry on. The checkpoint is graph-sync's, which records the scopes and filter its cursor was issued under.
 */
export const syncRecordSchema = z
  .strictObject({
    modelId: z.string().min(1),
    /** Present while the sync has more to read. */
    checkpoint: syncCheckpointSchema.optional(),
    gaps: z.array(gapSchema).readonly(),
  })
  .readonly();

export type SyncRecord = z.infer<typeof syncRecordSchema>;
