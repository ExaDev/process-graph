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

/** A cell of a list shared by every list that ends with it. */
interface Cell<T> {
  readonly value: T;
  readonly next: Cell<T> | undefined;
}

/** A component's reachable targets: a list of cells, possibly shared with the components after it, or its own targets and the structures of the components it leads to, read with duplicates removed. */
type Reach<T> =
  | { readonly head: Cell<T> | undefined }
  | { readonly own: readonly T[]; readonly parts: readonly Reach<T>[] };

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
  /** The chains that start with `first`, one per accepted element it leads to, in the order a depth-first walk reaches them. */
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
 * The folded elements are condensed into strongly connected components in one pass. Each component's reachable accepted targets are held as a shared structure, never as a list per component: a component whose only way on leads to a list nothing else extends takes that list over and prepends its own targets as cells, and any other component points at its own targets and its successors' structures. The structure stores one reference per target cell, own target and successor, so its size is linear in the elements and transitions; duplicates are removed when a component's targets are first read, and that read is remembered. Folded elements entered from exactly one folded element, outside any cycle, form a forest of routes; each records how deep it is and the last trigger, effect and guard on the way down to it, so a single-route chain's labels are found from its ends in constant time.
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

  // Each component's accepted targets as a shared structure, built in reverse topological order so every successor's is ready. Nothing is copied: a list grows by prepending cells onto its successor's, and a merge only points at its parts.
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
  const reaches: Reach<I["element"]>[] = [];
  // The set of a list's targets, for removing duplicates while building, held only by the one component still allowed to extend that list.
  const owned = new Map<number, Set<I["element"]>>();
  const leads: boolean[] = [];
  for (const [index, members] of components.entries()) {
    const own: I["element"][] = [];
    const ownSet = new Set<I["element"]>();
    for (const member of members) {
      for (const { target } of outgoing.get(member) ?? []) {
        if (
          !isFolded.has(target) &&
          folding.accepted(target) &&
          !ownSet.has(target)
        ) {
          ownSet.add(target);
          own.push(target);
        }
      }
    }
    const parts = (successorsOf[index] ?? []).filter(
      (successor) => leads[successor] === true,
    );
    leads[index] = own.length > 0 || parts.length > 0;
    const [only, ...others] = parts;
    const onlyReach = only === undefined ? undefined : reaches[only];
    const takeable =
      only === undefined
        ? undefined
        : predecessors[only] === 1
          ? owned.get(only)
          : undefined;
    if (only === undefined) {
      // A component with nowhere further to go starts a list of its own targets.
      let head: Cell<I["element"]> | undefined;
      for (const target of own.toReversed()) {
        observe?.(1);
        head = { value: target, next: head };
      }
      owned.set(index, ownSet);
      observe?.(ownSet.size);
      reaches[index] = { head };
    } else if (
      others.length === 0 &&
      takeable !== undefined &&
      onlyReach !== undefined &&
      "head" in onlyReach &&
      own.every((target) => !takeable.has(target))
    ) {
      // The only way on leads to a list nothing else extends and that holds none of this component's own targets: take it over and prepend them, so they come first as they would in a merge.
      owned.delete(only);
      let head = onlyReach.head;
      for (const target of own.toReversed()) {
        observe?.(1);
        takeable.add(target);
        head = { value: target, next: head };
      }
      owned.set(index, takeable);
      reaches[index] = { head };
    } else if (
      others.length === 0 &&
      own.length === 0 &&
      onlyReach !== undefined
    ) {
      reaches[index] = onlyReach;
    } else {
      observe?.(own.length + parts.length);
      reaches[index] = {
        own,
        parts: parts.flatMap((part) => {
          const reach = reaches[part];

          return reach === undefined ? [] : [reach];
        }),
      };
    }
  }
  // Read once per component asked about: the targets in order, own before successors', each once, walking every shared cell and part only once.
  const readTargets = new Map<number, readonly I["element"][]>();
  const targetsOf = (component: number): readonly I["element"][] => {
    const known = readTargets.get(component);
    if (known !== undefined) {
      return known;
    }
    const start = reaches[component];
    const found: I["element"][] = [];
    const listed = new Set<I["element"]>();
    const visited = new Set<Reach<I["element"]> | Cell<I["element"]>>();
    const stack: Reach<I["element"]>[] = start === undefined ? [] : [start];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      if ("head" in next) {
        for (
          let cell = next.head;
          cell !== undefined && !visited.has(cell);
          cell = cell.next
        ) {
          visited.add(cell);
          if (!listed.has(cell.value)) {
            listed.add(cell.value);
            found.push(cell.value);
          }
        }
        continue;
      }
      for (const target of next.own) {
        if (!listed.has(target)) {
          listed.add(target);
          found.push(target);
        }
      }
      for (const part of next.parts.toReversed()) {
        stack.push(part);
      }
    }
    observe?.(found.length);
    readTargets.set(component, found);

    return found;
  };

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
