import {
  buildDag,
  stronglyConnectedComponents,
} from "@exadev/process-graph-dag";
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

/** A value found on a route, with how deep in the route forest it was found and whether it came from the folded element itself (after the transition arriving at it) or from that transition. */
interface Found<V> {
  readonly value: V;
  readonly depth: number;
  readonly atElement: boolean;
}

/** A guard on a route, linked to the guards before it; shared between every route through the same elements. */
interface GuardLink {
  readonly guard: string;
  readonly depth: number;
  readonly previous: GuardLink | undefined;
}

/**
 * Everything that leads from one transition to one drawn element through folded elements. Several routes from the same first transition to the same target are one chain. The lists are built only when read, so a projection that draws many chains sharing a long run of folded elements does not copy that run once per chain.
 */
export interface Chain<I extends IdSpace> {
  readonly first: TransitionOf<I>;
  readonly target: I["element"];
  /** Whether more than one route may lead to `target`: some folded element on the way, or `target` itself, is entered from more than one folded element, or the way passes a cycle of folded elements. */
  readonly merged: boolean;
  /** Every transition on some route to `target`, each once, in the order a depth-first walk in model order first meets them; the first transition comes first. Built when called. */
  readonly transitions: () => readonly TransitionOf<I>[];
  /** Every folded element on some route to `target`, each once, in the same order. Empty when `first` arrives at `target` directly. Built when called. */
  readonly through: () => readonly I["element"][];
  /** On a single route, its guards in order; on merged routes, none, since they belong to different routes. Built when called. */
  readonly guards: () => readonly string[];
  /** Whether `guards` is non-empty, known without building it. */
  readonly guarded: boolean;
  /** On a single route, the last trigger along it, counting each folded element's own event right after the transition arriving at it; `undefined` on merged routes. */
  readonly trigger: I["event"] | undefined;
  /** On a single route, the last effect along it; `undefined` on merged routes. */
  readonly effect: I["action"] | undefined;
}

/** A component's reachable targets, stored in reverse of the order they are read in, so a reader is extended by pushing; `members` is kept only while some later component may still take the array over. */
interface Targets<T> {
  readonly reversed: T[];
  members: Set<T> | undefined;
  /** Whether a start reads this array or more than one component builds on it, so it must never be extended in place. */
  pinned: boolean;
}

/** One part of what a component's targets are made of, in reading order: targets of a component it holds itself, or the array of a component built on its own. */
type Piece<T> =
  | { readonly own: readonly T[]; readonly component?: never }
  | { readonly component: number; readonly own?: never };

/** What a notation folds away and what it draws. */
export interface Folding<I extends IdSpace> {
  /** Whether the notation folds an element away instead of drawing it. Asked once per element. */
  readonly folded: (element: I["element"]) => boolean;
  /** Whether a chain may end at an element the notation does not fold. */
  readonly accepted: (element: I["element"]) => boolean;
  /** The event a folded element contributes to a route, such as a message element's; asked once per folded element. */
  readonly eventOf?: (element: I["element"]) => I["event"] | undefined;
  /** Told how many references the index stores whenever it stores target structure, so a caller can measure its size. */
  readonly observe?: (references: number) => void;
}

/** Chains through one model's folded elements, built once and shared by every chain that starts with a transition of that model. */
export interface ChainIndex<I extends IdSpace> {
  /** The chains that start with `first`, one per accepted element it leads to: first the ones its own folded element leaves for directly that nothing further on reaches, then those further on, a target reached by several ways on coming with the last of them. */
  readonly from: (first: TransitionOf<I>) => readonly Chain<I>[];
  /** The transitions arriving at `element` from folded elements. */
  readonly arriving: (element: I["element"]) => readonly TransitionOf<I>[];
  /** The folded elements on some chain that starts with one of `firsts`. */
  readonly carried: (
    firsts: Readonly<Iterable<TransitionOf<I>>>,
  ) => ReadonlySet<I["element"]>;
}

/** Appends `value` to the list `map` holds under `key`. */
const append = <Key, Value>(
  map: Map<Key, Value[]>,
  key: Key,
  value: Value,
): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
};

/** A computation run once, on first call, and remembered. */
export const once = <T>(compute: () => T): (() => T) => {
  let memo: { readonly value: T } | undefined;

  return () => {
    memo ??= { value: compute() };

    return memo.value;
  };
};

/**
 * Indexes a model's folded elements so chains can be read off for any first transition.
 *
 * The folded elements are condensed into strongly connected components in one pass, and the condensed graph is read in reverse topological order. A component gets a flat array of its accepted targets only when something reads it on its own: it is entered from an element that is not folded, or from two or more components. Every other component has at most one component before it and is read as part of that one, so it is visited once in all. Arrays are built on demand and remembered, so a region no start reaches costs nothing; a generation stamp per target removes duplicates in constant time, a component with nothing of its own to add shares the one array it reads, and the only builder of an array nothing else reads extends it in place instead of copying it. The total work is linear in the elements and transitions plus the sizes of the arrays that must be copied, which is where two or more starts, or two or more components, read the same targets. Folded elements entered from exactly one folded element, outside any cycle, form a forest of routes; each records how deep it is and the last trigger, effect and guard on the way down to it, so a single-route chain's labels are found from its ends in constant time.
 *
 * Merged chains' lists, and every chain's lists, are built only when read.
 */
export const chainIndex = <I extends IdSpace>(
  model: Model<I>,
  folding: Folding<I>,
): ChainIndex<I> => {
  const outgoing = outgoingMap(model);
  const isFolded = new Set<I["element"]>();
  for (const element of model.elements) {
    if (folding.folded(element.id)) {
      isFolded.add(element.id);
    }
  }
  const events = new Map<I["element"], I["event"]>();
  for (const id of isFolded) {
    const event = folding.eventOf?.(id);
    if (event !== undefined) {
      events.set(id, event);
    }
  }

  const foldedIn = new Map<I["element"], TransitionOf<I>[]>();
  const arrivingIn = new Map<I["element"], TransitionOf<I>[]>();
  for (const transition of model.transitions) {
    if (!isFolded.has(transition.source)) {
      continue;
    }
    append(
      isFolded.has(transition.target) ? foldedIn : arrivingIn,
      transition.target,
      transition,
    );
  }

  const foldedIds = [...isFolded];
  const components = stronglyConnectedComponents(
    buildDag(foldedIds, (id) =>
      (outgoing.get(id) ?? [])
        .map((transition) => transition.target)
        .filter((target) => isFolded.has(target)),
    ),
  );
  const componentOf = new Map<I["element"], number>();
  for (const [index, members] of components.entries()) {
    for (const member of members) {
      componentOf.set(member, index);
    }
  }
  const cyclic = new Set<I["element"]>();
  for (const members of components) {
    const [only] = members;
    const selfLoop =
      only !== undefined &&
      (outgoing.get(only) ?? []).some(
        (transition) => transition.target === only,
      );
    if (members.length > 1 || selfLoop) {
      for (const member of members) {
        cyclic.add(member);
      }
    }
  }

  const observe = folding.observe;
  const successorsOf: number[][] = components.map(() => []);
  const predecessors = components.map(() => 0);
  for (const [index, members] of components.entries()) {
    const seen = new Set<number>();
    for (const member of members) {
      for (const { target } of outgoing.get(member) ?? []) {
        const successor = componentOf.get(target);
        if (
          successor !== undefined &&
          successor !== index &&
          !seen.has(successor)
        ) {
          seen.add(successor);
          successorsOf[index]?.push(successor);
          predecessors[successor] = (predecessors[successor] ?? 0) + 1;
        }
      }
    }
  }
  // Each component's targets are a flat array, built only for the components something reads on its own: a start (entered from an element that is not folded) or a component entered from two or more components. Every other component has at most one component before it and is read as part of that one, so it is visited once in all. Arrays are built on demand and remembered, so a region no start reaches costs nothing.
  const enteredFromOutside = new Set<number>();
  for (const transition of model.transitions) {
    const component = componentOf.get(transition.target);
    if (component !== undefined && !isFolded.has(transition.source)) {
      enteredFromOutside.add(component);
    }
  }
  const standalone = (component: number): boolean =>
    enteredFromOutside.has(component) || (predecessors[component] ?? 0) > 1;
  const ownOf = (component: number): I["element"][] => {
    const own: I["element"][] = [];
    for (const member of components[component] ?? []) {
      for (const { target } of outgoing.get(member) ?? []) {
        if (!isFolded.has(target) && folding.accepted(target)) {
          own.push(target);
        }
      }
    }

    return own;
  };
  /** What a standalone component's targets are made of, in reading order: its own targets, then each way on's in order, reading through components that stand only on it and stopping at the next standalone ones. */
  const piecesOf = (component: number): Piece<I["element"]>[] => {
    const found: Piece<I["element"]>[] = [];
    // Visit a component standing on the one before it, or record a standalone one met at this point in reading order.
    const stack: { readonly component: number; readonly visit: boolean }[] = [
      { component, visit: true },
    ];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (!next.visit) {
        observe?.(1);
        found.push({ component: next.component });
        continue;
      }
      const own = ownOf(next.component);
      if (own.length > 0) {
        observe?.(own.length);
        found.push({ own });
      }
      for (const successor of (
        successorsOf[next.component] ?? []
      ).toReversed()) {
        stack.push({ component: successor, visit: !standalone(successor) });
      }
    }

    return found;
  };
  const piecesFor = new Map<number, Piece<I["element"]>[]>();
  const pieces = (component: number): Piece<I["element"]>[] => {
    const known = piecesFor.get(component);
    if (known !== undefined) {
      return known;
    }
    const found = piecesOf(component);
    piecesFor.set(component, found);

    return found;
  };
  // How many standalone components build directly on each standalone one, counted once each, so an array read by one builder alone can be extended in place by it.
  const builders = new Map<number, number>();
  for (const [index] of components.entries()) {
    if (!standalone(index)) {
      continue;
    }
    const readFrom = new Set(
      pieces(index).flatMap((piece) =>
        piece.component === undefined ? [] : [piece.component],
      ),
    );
    for (const read of readFrom) {
      builders.set(read, (builders.get(read) ?? 0) + 1);
    }
  }
  const pinnedFor = (component: number): boolean =>
    enteredFromOutside.has(component) || (builders.get(component) ?? 0) > 1;

  const arrays = new Map<number, Targets<I["element"]>>();
  // A generation stamp per target for removing duplicates while one array is built: a target is already in the array when its stamp is the current generation.
  const stamp = new Map<I["element"], number>();
  let generation = 0;
  const build = (component: number): Targets<I["element"]> => {
    const parts = pieces(component);
    const [only, ...more] = parts;
    const onlyArray =
      only?.component === undefined ? undefined : arrays.get(only.component);
    if (onlyArray !== undefined && more.length === 0) {
      // Nothing of its own to add to the one array it reads: share it.
      onlyArray.pinned ||= pinnedFor(component);

      return onlyArray;
    }
    // Reading order keeps each target at its last place: the own targets nothing further on reaches come first. Built backwards, that is each target's first place, so pieces are taken last to first and each piece from its end.
    const last = parts.at(-1);
    const lastArray =
      last?.component === undefined ? undefined : arrays.get(last.component);
    const takeOver =
      lastArray !== undefined &&
      !lastArray.pinned &&
      lastArray.members !== undefined;
    const target: Targets<I["element"]> = takeOver
      ? lastArray
      : { reversed: [], members: undefined, pinned: pinnedFor(component) };
    target.pinned = pinnedFor(component);
    generation += 1;
    const members = target.members;
    const present = (value: I["element"]): boolean =>
      members === undefined
        ? stamp.get(value) === generation
        : members.has(value);
    const add = (value: I["element"]): void => {
      if (present(value)) {
        return;
      }
      observe?.(1);
      target.reversed.push(value);
      if (members === undefined) {
        stamp.set(value, generation);
      } else {
        members.add(value);
      }
    };
    for (const piece of (takeOver ? parts.slice(0, -1) : parts).toReversed()) {
      if (piece.own !== undefined) {
        for (const value of piece.own.toReversed()) {
          add(value);
        }
        continue;
      }
      for (const value of arrays.get(piece.component)?.reversed ?? []) {
        add(value);
      }
    }
    // An array nobody else may read keeps a set of its members, so the one component that builds on it can take it over without rescanning it.
    if (target.pinned) {
      target.members = undefined;
    } else if (target.members === undefined) {
      observe?.(target.reversed.length);
      target.members = new Set(target.reversed);
    }

    return target;
  };
  const arrayOf = (component: number): Targets<I["element"]> => {
    const frames: { readonly component: number; expanded: boolean }[] = [
      { component, expanded: false },
    ];
    for (
      let frame = frames.at(-1);
      frame !== undefined;
      frame = frames.at(-1)
    ) {
      if (arrays.has(frame.component)) {
        frames.pop();
        continue;
      }
      if (!frame.expanded) {
        frame.expanded = true;
        for (const piece of pieces(frame.component)) {
          if (piece.component !== undefined && !arrays.has(piece.component)) {
            frames.push({ component: piece.component, expanded: false });
          }
        }
        continue;
      }
      arrays.set(frame.component, build(frame.component));
      frames.pop();
    }
    const found = arrays.get(component);
    if (found === undefined) {
      throw new Error(
        "Invariant violated: a component's targets were not built",
      );
    }

    return found;
  };
  const leads: boolean[] = [];
  for (const [index] of components.entries()) {
    leads[index] =
      ownOf(index).length > 0 ||
      (successorsOf[index] ?? []).some(
        (successor) => leads[successor] === true,
      );
  }
  /** A start component's targets in reading order; only ever asked of a component entered from outside, which is standalone. */
  const targetsOf = (component: number): readonly I["element"][] =>
    arrayOf(component).reversed.toReversed();

  // The route forest: a folded element outside every cycle entered from exactly one folded element that is also outside every cycle hangs below it.
  const parentLink = new Map<I["element"], TransitionOf<I>>();
  const children = new Map<I["element"], I["element"][]>();
  for (const id of foldedIds) {
    const into = foldedIn.get(id) ?? [];
    const [link, ...rest] = into;
    if (
      link !== undefined &&
      rest.length === 0 &&
      !cyclic.has(id) &&
      !cyclic.has(link.source)
    ) {
      parentLink.set(id, link);
      append(children, link.source, id);
    }
  }
  const depth = new Map<I["element"], number>();
  const enter = new Map<I["element"], number>();
  const leave = new Map<I["element"], number>();
  const lastTrigger = new Map<I["element"], Found<I["event"]>>();
  const lastEffect = new Map<I["element"], Found<I["action"]>>();
  const guardsTo = new Map<I["element"], GuardLink>();
  let clock = 0;
  for (const root of foldedIds) {
    if (parentLink.has(root)) {
      continue;
    }
    const stack: { readonly id: I["element"]; next: number }[] = [
      { id: root, next: 0 },
    ];
    const visit = (id: I["element"], level: number): void => {
      depth.set(id, level);
      enter.set(id, clock);
      clock += 1;
      const link = parentLink.get(id);
      const parent = link?.source;
      const event = events.get(id);
      const trigger =
        event !== undefined
          ? { value: event, depth: level, atElement: true }
          : link?.trigger !== undefined
            ? { value: link.trigger, depth: level, atElement: false }
            : parent === undefined
              ? undefined
              : lastTrigger.get(parent);
      if (trigger !== undefined) {
        lastTrigger.set(id, trigger);
      }
      const effect =
        link?.effect !== undefined
          ? { value: link.effect, depth: level, atElement: false }
          : parent === undefined
            ? undefined
            : lastEffect.get(parent);
      if (effect !== undefined) {
        lastEffect.set(id, effect);
      }
      const above = parent === undefined ? undefined : guardsTo.get(parent);
      const guards =
        link?.guard !== undefined
          ? { guard: link.guard, depth: level, previous: above }
          : above;
      if (guards !== undefined) {
        guardsTo.set(id, guards);
      }
    };
    visit(root, 0);
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const child = (children.get(top.id) ?? [])[top.next];
      if (child === undefined) {
        leave.set(top.id, clock);
        stack.pop();
        continue;
      }
      top.next += 1;
      visit(child, (depth.get(top.id) ?? 0) + 1);
      stack.push({ id: child, next: 0 });
    }
  }
  /** Whether `ancestor` is `node` or above it in the route forest. */
  const above = (ancestor: I["element"], node: I["element"]): boolean => {
    const start = enter.get(ancestor);
    const stop = leave.get(ancestor);
    const at = enter.get(node);

    return (
      start !== undefined &&
      stop !== undefined &&
      at !== undefined &&
      start <= at &&
      at < stop
    );
  };

  /** The union of every route from `start` to `target`, by a depth-first walk from `start` and a walk back from `target` over what it met. */
  const union = (
    first: TransitionOf<I>,
    target: I["element"],
  ): {
    readonly transitions: readonly TransitionOf<I>[];
    readonly through: readonly I["element"][];
  } => {
    const met: TransitionOf<I>[] = [first];
    const entered: I["element"][] = [first.target];
    const seen = new Set<I["element"]>([first.target]);
    const stack: { readonly id: I["element"]; next: number }[] = [
      { id: first.target, next: 0 },
    ];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const transition = (outgoing.get(top.id) ?? [])[top.next];
      if (transition === undefined) {
        stack.pop();
        continue;
      }
      top.next += 1;
      met.push(transition);
      if (isFolded.has(transition.target) && !seen.has(transition.target)) {
        seen.add(transition.target);
        entered.push(transition.target);
        stack.push({ id: transition.target, next: 0 });
      }
    }
    const into = new Map<I["element"], TransitionOf<I>[]>();
    for (const transition of met) {
      append(into, transition.target, transition);
    }
    const leading = new Set<I["element"]>([target]);
    const back: I["element"][] = [target];
    for (let at = back.pop(); at !== undefined; at = back.pop()) {
      for (const transition of into.get(at) ?? []) {
        if (seen.has(transition.source) && !leading.has(transition.source)) {
          leading.add(transition.source);
          back.push(transition.source);
        }
      }
    }

    return {
      transitions: met.filter((transition) => leading.has(transition.target)),
      through: entered.filter((id) => leading.has(id)),
    };
  };

  const from = (first: TransitionOf<I>): readonly Chain<I>[] => {
    const start = first.target;
    if (!isFolded.has(start)) {
      return folding.accepted(start)
        ? [
            {
              first,
              target: start,
              merged: false,
              transitions: () => [first],
              through: () => [],
              guards: () => (first.guard === undefined ? [] : [first.guard]),
              guarded: first.guard !== undefined,
              trigger: first.trigger,
              effect: first.effect,
            },
          ]
        : [];
    }
    const component = componentOf.get(start);
    const reached = component === undefined ? [] : targetsOf(component);
    const level = depth.get(start);

    return reached.map((target): Chain<I> => {
      const [last, ...more] = arrivingIn.get(target) ?? [];
      const source = last?.source;
      const single =
        last !== undefined &&
        source !== undefined &&
        more.length === 0 &&
        level !== undefined &&
        above(start, source);
      const lists = once(() => union(first, target));
      if (!single) {
        return {
          first,
          target,
          merged: true,
          transitions: () => lists().transitions,
          through: () => lists().through,
          guards: () => [],
          guarded: false,
          trigger: undefined,
          effect: undefined,
        };
      }
      // Along the route, what lies strictly below `start` counts, and at `start` only its own event: the transition into `start` is not on the route.
      const onRoute = (found: Found<unknown> | undefined): boolean =>
        found !== undefined &&
        (found.depth > level || (found.depth === level && found.atElement));
      const triggerFound = lastTrigger.get(source);
      const effectFound = lastEffect.get(source);
      const guardsFound = guardsTo.get(source);
      const routeGuards = once(() => {
        const middle: string[] = [];
        for (
          let link = guardsFound;
          link !== undefined && link.depth > level;
          link = link.previous
        ) {
          middle.push(link.guard);
        }

        return [
          ...(first.guard === undefined ? [] : [first.guard]),
          ...middle.toReversed(),
          ...(last.guard === undefined ? [] : [last.guard]),
        ];
      });
      const route = once(() => {
        const nodes: I["element"][] = [];
        const links: TransitionOf<I>[] = [];
        for (let at: I["element"] | undefined = source; at !== undefined;) {
          nodes.push(at);
          if (at === start) {
            break;
          }
          const link = parentLink.get(at);
          if (link !== undefined) {
            links.push(link);
          }
          at = link?.source;
        }

        return {
          through: nodes.toReversed(),
          transitions: [first, ...links.toReversed(), last],
        };
      });

      return {
        first,
        target,
        merged: false,
        transitions: () => route().transitions,
        through: () => route().through,
        guards: routeGuards,
        guarded:
          first.guard !== undefined ||
          last.guard !== undefined ||
          (guardsFound !== undefined && guardsFound.depth > level),
        trigger:
          last.trigger ??
          (onRoute(triggerFound) ? triggerFound?.value : undefined) ??
          first.trigger,
        effect:
          last.effect ??
          (effectFound !== undefined && effectFound.depth > level
            ? effectFound.value
            : undefined) ??
          first.effect,
      };
    });
  };

  const carried = (
    firsts: Readonly<Iterable<TransitionOf<I>>>,
  ): ReadonlySet<I["element"]> => {
    const reached = new Set<I["element"]>();
    const stack: I["element"][] = [];
    for (const first of firsts) {
      if (isFolded.has(first.target) && !reached.has(first.target)) {
        reached.add(first.target);
        stack.push(first.target);
      }
    }
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      for (const transition of outgoing.get(at) ?? []) {
        if (
          isFolded.has(transition.target) &&
          !reached.has(transition.target)
        ) {
          reached.add(transition.target);
          stack.push(transition.target);
        }
      }
    }
    const leading = new Set<I["element"]>();
    for (const id of reached) {
      const component = componentOf.get(id);
      if (component !== undefined && leads[component] === true) {
        leading.add(id);
      }
    }

    return leading;
  };

  return {
    from,
    arriving: (element) => arrivingIn.get(element) ?? [],
    carried,
  };
};
