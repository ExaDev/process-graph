import type { IdSpace, Model } from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";

export interface Handoff<I extends IdSpace> {
  readonly transition: I["transition"];
  readonly from: I["actor"];
  readonly to: I["actor"];
}

/**
 * Swimlane view: a transition between two elements with different actors is a hand-off. Elements without an actor never produce one.
 */
export const handoffs = <I extends IdSpace>(
  model: Model<I>,
): readonly Handoff<I>[] => {
  const actorOf = actorMap(model);

  const found: Handoff<I>[] = [];
  for (const transition of model.transitions) {
    const from = actorOf.get(transition.source);
    const to = actorOf.get(transition.target);
    if (from !== undefined && to !== undefined && from !== to) {
      found.push({ transition: transition.id, from, to });
    }
  }

  return found;
};
