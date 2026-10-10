import type { IdSpace } from "@exadev/process-graph-schema";
import type { Analysis } from "./derive.ts";
import { lookup } from "./lookup.ts";
import type { Status } from "./status.ts";

/** Whether an element still has work ahead of it: it is neither finished nor going to be skipped. */
export const isLive = (status: Status): boolean =>
  status !== "done" && status !== "skipped";

/** The live needs of an element that are not done: what it is still waiting for. A finished or skipped element waits on nothing, even when the overlay marked it done ahead of its needs or it consumes an artefact still to be made. */
export const waitingOn = <I extends IdSpace>(
  analysis: Analysis<I>,
  id: I["element"],
): readonly I["element"][] =>
  isLive(lookup(analysis.statuses, id))
    ? lookup(analysis.liveNeeds, id).filter(
        (need) => lookup(analysis.statuses, need) !== "done",
      )
    : [];
