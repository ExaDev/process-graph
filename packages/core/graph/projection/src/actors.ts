import type { Element, IdSpace, Model } from "@exadev/process-graph-schema";

export type ElementOf<I extends IdSpace> = Element<I["element"], I>;

export const actorMap = <I extends IdSpace>(
  model: Model<I>,
): ReadonlyMap<I["element"], I["actor"]> => {
  const actors = new Map<I["element"], I["actor"]>();
  for (const element of model.elements) {
    if (
      (element.kind === "activity" || element.kind === "decision") &&
      element.actor !== undefined
    ) {
      actors.set(element.id, element.actor);
    }
  }

  return actors;
};
