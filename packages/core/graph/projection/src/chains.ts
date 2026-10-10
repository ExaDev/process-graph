import type { IdSpace, Model, Transition } from "@exadev/process-graph-schema";

export type TransitionOf<I extends IdSpace> = Transition<I["transition"], I>;

/** The transitions leaving each element, in model order. */
export const outgoingMap = <I extends IdSpace>(
  model: Model<I>,
): ReadonlyMap<I["element"], readonly TransitionOf<I>[]> => {
  const outgoing = new Map<I["element"], TransitionOf<I>[]>();
  for (const transition of model.transitions) {
    const list = outgoing.get(transition.source);
    if (list === undefined) {
      outgoing.set(transition.source, [transition]);
    } else {
      list.push(transition);
    }
  }

  return outgoing;
};

/** A run of transitions from a drawn element to the next drawn element, passing through elements the notation folds away. */
export interface Chain<I extends IdSpace> {
  /** The transitions in order; the first leaves the start element and the last arrives at `target`. */
  readonly transitions: readonly TransitionOf<I>[];
  /** The folded elements passed through, in order. Empty when the chain is a single transition. */
  readonly through: readonly I["element"][];
  readonly target: I["element"];
}

/**
 * Every chain that starts with `first` and continues through folded elements until it reaches an element that is not folded. A folded element already passed on the same chain ends it there, so a cycle among folded elements yields a chain whose target is that folded element, which the caller does not draw.
 *
 * Chains come out in depth-first order over each element's outgoing transitions in model order. The walk uses an explicit stack, so depth is bounded by memory.
 * @param first - The transition the chains start with.
 * @param outgoing - The transitions leaving each element.
 * @param folded - Whether the notation folds an element away instead of drawing it.
 */
export const chainsFrom = <I extends IdSpace>(
  first: TransitionOf<I>,
  outgoing: ReadonlyMap<I["element"], readonly TransitionOf<I>[]>,
  folded: (element: I["element"]) => boolean,
): readonly Chain<I>[] => {
  const chains: Chain<I>[] = [];
  // Each entry is a chain walked so far; its `target` is where the last transition arrives.
  const stack: Chain<I>[] = [
    { transitions: [first], through: [], target: first.target },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { target } = next;
    if (!folded(target) || next.through.includes(target)) {
      chains.push(next);
      continue;
    }
    const through = [...next.through, target];
    const onward = outgoing.get(target) ?? [];
    for (const transition of onward.toReversed()) {
      stack.push({
        transitions: [...next.transitions, transition],
        through,
        target: transition.target,
      });
    }
  }

  return chains;
};
