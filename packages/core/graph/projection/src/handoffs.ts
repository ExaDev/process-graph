import type { IdSpace, Model } from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";
import { chainIndex } from "./chains.ts";

export interface Handoff<I extends IdSpace> {
  /** The transition the hand-off starts with. */
  readonly transition: I["transition"];
  readonly from: I["actor"];
  readonly to: I["actor"];
  /** The `message` elements the hand-off passes through, each once in the order met, when it is carried by a message; built when first read. */
  readonly through?: readonly I["element"][];
}

/**
 * Swimlane view: a transition between two elements with different actors is a hand-off. A transition into a `message` element continues through it to the element after it, so a message between two steps is part of the hand-off it carries, not an end of it. Elements without an actor never produce one.
 * @param model - The model to read.
 * @returns The hand-offs, in the order of the transitions they start with.
 */
export const handoffs = <I extends IdSpace>(
  model: Model<I>,
): readonly Handoff<I>[] => {
  const actorOf = actorMap(model);
  const messages = new Set<I["element"]>(
    model.elements.flatMap((element) =>
      element.kind === "message" ? [element.id] : [],
    ),
  );
  const index = chainIndex(model, {
    folded: (id) => messages.has(id),
    accepted: (id) => actorOf.has(id),
  });

  const found: Handoff<I>[] = [];
  for (const transition of model.transitions) {
    const from = actorOf.get(transition.source);
    if (from === undefined) {
      continue;
    }
    for (const chain of index.from(transition)) {
      const to = actorOf.get(chain.target);
      if (to === undefined || from === to) {
        continue;
      }
      found.push(
        transition.target === chain.target
          ? { transition: transition.id, from, to }
          : {
              transition: transition.id,
              from,
              to,
              get through(): readonly I["element"][] {
                return chain.through();
              },
            },
      );
    }
  }

  return found;
};
