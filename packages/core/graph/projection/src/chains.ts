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

/**
 * Everything that leads from one transition to one element through folded elements: from a drawn element to the next drawn element, or, when the folded elements form a cycle, to the folded element the cycle returns to. Several routes from the same first transition to the same target are one chain.
 */
export interface Chain<I extends IdSpace> {
  /** Every transition on some route from the first transition to `target`, each once, in the order the walk first met them. The first transition comes first. */
  readonly transitions: readonly TransitionOf<I>[];
  /** Every folded element on some route to `target`, each once, in the order the walk first met them. Empty when the chain is a single transition. */
  readonly through: readonly I["element"][];
  readonly target: I["element"];
  /** Whether more than one route leads to `target`, so `transitions` is a union of routes rather than one route in order. */
  readonly merged: boolean;
}

/**
 * The chains that start with `first`: one for each element it leads to through folded elements, in the order the walk first reaches them.
 *
 * The walk is depth-first over each element's outgoing transitions in model order, with an explicit stack and a visited set, so each folded element is entered once and each transition leaving one is followed once, and `folded` is asked once per element reached. Routes through different folded elements that reach the same target are collapsed into one chain rather than enumerated, so the number of chains is at most the number of elements reached, whatever the number of routes. A transition that arrives back at a folded element still on the walk's stack closes a cycle; that element is then also a chain target, which no notation draws because it is folded.
 *
 * After the walk, each target's `transitions` and `through` are found by walking back from it over the transitions met, so building every chain takes at most the number of targets times the number of transitions met.
 * @param first - The transition the chains start with.
 * @param outgoing - The transitions leaving each element.
 * @param folded - Whether the notation folds an element away instead of drawing it.
 * @returns One chain per target, in the order the walk first reaches each target.
 */
export const chainsFrom = <I extends IdSpace>(
  first: TransitionOf<I>,
  outgoing: ReadonlyMap<I["element"], readonly TransitionOf<I>[]>,
  folded: (element: I["element"]) => boolean,
): readonly Chain<I>[] => {
  const isFolded = new Map<I["element"], boolean>();
  const foldedOnce = (element: I["element"]): boolean => {
    const known = isFolded.get(element);
    if (known !== undefined) {
      return known;
    }
    const answer = folded(element);
    isFolded.set(element, answer);

    return answer;
  };

  /** Folded elements entered, in order, and whether each is still on the stack (`open`) or finished. */
  const state = new Map<I["element"], "open" | "done">();
  const entered: I["element"][] = [];
  const met: TransitionOf<I>[] = [];
  const targets: I["element"][] = [];
  const isTarget = new Set<I["element"]>();
  const addTarget = (element: I["element"]): void => {
    if (!isTarget.has(element)) {
      isTarget.add(element);
      targets.push(element);
    }
  };
  const arrive = (transition: TransitionOf<I>): boolean => {
    met.push(transition);
    const { target } = transition;
    if (!foldedOnce(target)) {
      addTarget(target);

      return false;
    }
    const seen = state.get(target);
    if (seen === "open") {
      addTarget(target);
    }
    if (seen !== undefined) {
      return false;
    }
    state.set(target, "open");
    entered.push(target);

    return true;
  };

  const stack: { readonly element: I["element"]; next: number }[] = [];
  if (arrive(first)) {
    stack.push({ element: first.target, next: 0 });
  }
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const transition = (outgoing.get(top.element) ?? [])[top.next];
    if (transition === undefined) {
      state.set(top.element, "done");
      stack.pop();
      continue;
    }
    top.next += 1;
    if (arrive(transition)) {
      stack.push({ element: transition.target, next: 0 });
    }
  }

  const incoming = new Map<I["element"], TransitionOf<I>[]>();
  for (const transition of met) {
    const into = incoming.get(transition.target);
    if (into === undefined) {
      incoming.set(transition.target, [transition]);
    } else {
      into.push(transition);
    }
  }

  return targets.map((target) => {
    // The folded elements that lead to `target`, found by walking back over the transitions met; only folded elements are walked through, as the routes only pass through those.
    const leading = new Set<I["element"]>([target]);
    const back: I["element"][] = [target];
    for (let at = back.pop(); at !== undefined; at = back.pop()) {
      for (const transition of incoming.get(at) ?? []) {
        if (state.has(transition.source) && !leading.has(transition.source)) {
          leading.add(transition.source);
          back.push(transition.source);
        }
      }
    }
    const transitions = met.filter((transition) =>
      leading.has(transition.target),
    );
    const through = entered.filter((element) => leading.has(element));
    const leaving = new Map<I["element"], number>();
    for (const transition of transitions) {
      leaving.set(transition.source, (leaving.get(transition.source) ?? 0) + 1);
    }

    return {
      transitions,
      through,
      target,
      merged:
        transitions.length !== through.length + 1 ||
        through.some(
          (element) => element !== target && leaving.get(element) !== 1,
        ),
    };
  });
};
