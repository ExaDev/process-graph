import {
  buildDag,
  immediateDominators,
  stronglyConnectedComponents,
} from "@exadev/process-graph-dag";
import type {
  Fragment,
  FragmentOperator,
  IdSpace,
  Model,
} from "@exadev/process-graph-schema";
import { outgoingMap, type TransitionOf } from "./chains.ts";
import type {
  SequenceItem,
  SequenceMessage,
  SequenceOperand,
} from "./sequence.ts";

/** A drawn message with its position among the drawn messages and the element it arrives at. */
export interface Entry<I extends IdSpace> {
  readonly index: number;
  readonly message: SequenceMessage<I>;
  readonly target: I["element"];
}

/** One scenario step and how many messages were drawn before it, so the messages a run of steps draws are a range of positions. */
export interface Step<I extends IdSpace> {
  readonly transition: TransitionOf<I>;
  readonly before: number;
}

/** The messages an operand holds: a run of consecutive positions given by its ends, or an ascending list of positions. A run is never expanded into its positions. */
type Held =
  | {
      readonly from: number;
      readonly to: number;
      readonly positions?: never;
      readonly elements?: never;
    }
  | {
      readonly positions: readonly number[];
      readonly from?: never;
      readonly elements?: never;
    }
  | {
      /** The elements whose messages the operand holds, each with the ascending positions of the messages arriving at it; the lists are shared by every operand holding the same element, never copied. */
      readonly elements: readonly {
        readonly element: string;
        readonly positions: readonly number[];
      }[];
      readonly from?: never;
      readonly positions?: never;
    };

type Operand = { readonly guard: string | undefined } & Held;

/** A fragment that may be drawn, with the messages each of its operands holds; operands never share a position. */
interface Candidate<I extends IdSpace> {
  /** The authored fragment's id; absent for a derived fragment. */
  readonly authored: I["fragment"] | undefined;
  readonly operands: readonly Operand[];
  /** Builds the item drawn for it from its operands' items. */
  readonly item: (operands: readonly SequenceOperand<I>[]) => SequenceItem<I>;
}

/** A choice or a split needs at least two branches, and an `opt` is exactly a choice between doing something and skipping it. */
const minBranches = 2;

/** The virtual end every last step leads to, for finding where branches meet. A number, so it never equals an element id, which is a string. */
const end = 0;

const derivedItem =
  <I extends IdSpace>(element: I["element"], operator: FragmentOperator) =>
  (operands: readonly SequenceOperand<I>[]): SequenceItem<I> => ({
    kind: "fragment",
    element,
    operator,
    operands,
  });

/** Appends `value` to the list `map` holds under `key`, starting the list when there is none. */
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

/** Counts work done over message positions, so a caller can measure it. */
export type Observe = (positions: number) => void;

/** One scenario as fragments see it: the model, its steps, the messages drawn, the elements it passes, and an optional work counter. */
export interface ScenarioPath<I extends IdSpace> {
  readonly model: Model<I>;
  readonly steps: readonly Step<I>[];
  readonly entries: readonly Entry<I>[];
  readonly onPath: ReadonlySet<I["element"]>;
  readonly observe?: Observe;
}

/**
 * The fragments the model's structure implies along the scenario, in model order of the decision or fork each comes from, each decision's loop before its other fragments.
 *
 * - A decision transition whose target is in the decision's strongly connected component goes round again, the rule `graph-domain` uses for a legal cycle. Each component holding such a decision on the path draws one `loop`, holding the messages that arrive inside the component, guarded by those transitions' guards joined with "or".
 * - Each time the path takes one of a decision's other (forward) branches, when it has at least two, an `alt` holds the messages from that step until the path reaches where the branches meet: the decision's immediate post-dominator over forward transitions, or the end of the path when they never meet. With exactly two branches, one going straight to where they meet, it is an `opt`, and taking that empty branch draws nothing. The path coming back to the decision ends the earlier occurrence.
 * - Each time the path leaves a fork, a `par` holds one operand per branch taken, each with the messages of the steps that follow on from that branch until it reaches the fork's immediate post-dominator; a branch taken again starts a new `par`.
 *
 * One pass finds every component and one pass every post-dominator, both only when the path passes a decision or fork, and the path is then read once, so the work is the size of the model and of the path, not their product.
 */
const deriveCandidates = <I extends IdSpace>({
  model,
  steps,
  entries,
  onPath,
  observe,
}: ScenarioPath<I>): Candidate<I>[] => {
  const branching = model.elements.filter(
    (element) =>
      onPath.has(element.id) &&
      (element.kind === "decision" ||
        (element.kind === "pseudo" && element.role === "fork")),
  );
  if (branching.length === 0) {
    return [];
  }

  const outgoing = outgoingMap(model);
  const ids = model.elements.map((element) => element.id);
  const component = new Map<I["element"], readonly I["element"][]>();
  for (const members of stronglyConnectedComponents(
    buildDag(ids, (id) =>
      (outgoing.get(id) ?? []).map((transition) => transition.target),
    ),
  )) {
    for (const member of members) {
      component.set(member, members);
    }
  }
  const loops = new Set<I["transition"]>();
  for (const element of model.elements) {
    const own = component.get(element.id);
    if (element.kind !== "decision" || own === undefined) {
      continue;
    }
    for (const transition of outgoing.get(element.id) ?? []) {
      if (component.get(transition.target) === own) {
        loops.add(transition.id);
      }
    }
  }

  // Post-dominators over forward transitions: read with each element needing the elements before it and the virtual end needing every element with no forward way on, the immediate dominators from the end are where each element's ways forward meet.
  const before = new Map<I["element"], I["element"][]>();
  const last: I["element"][] = [];
  for (const id of ids) {
    const forward = (outgoing.get(id) ?? []).filter(
      (transition) => !loops.has(transition.id),
    );
    if (forward.length === 0) {
      last.push(id);
    }
    for (const transition of forward) {
      append(before, transition.target, id);
    }
  }
  const meets = immediateDominators(
    buildDag<I["element"] | typeof end>([end, ...ids], (id) =>
      id === end ? last : (before.get(id) ?? []),
    ),
    end,
  );
  /** Where an element's ways forward meet, or `undefined` when they only meet at the end. */
  const meetOf = (id: I["element"]): I["element"] | undefined => {
    const meet = meets.get(id);

    return meet === undefined || meet === end ? undefined : meet;
  };

  const found = new Map<I["element"], Candidate<I>[]>();
  const add = (element: I["element"], candidate: Candidate<I>): void => {
    append(found, element, candidate);
  };

  // Loops: one per component, named by its first decision on the path in model order, holding the messages that arrive inside it.
  const looping = new Map<readonly I["element"][], I["element"]>();
  const loopGuards = new Map<readonly I["element"][], Set<string>>();
  for (const element of branching) {
    const own = component.get(element.id);
    const back = (outgoing.get(element.id) ?? []).filter((transition) =>
      loops.has(transition.id),
    );
    if (own === undefined || back.length === 0) {
      continue;
    }
    if (!looping.has(own)) {
      looping.set(own, element.id);
      loopGuards.set(own, new Set());
    }
    for (const transition of back) {
      if (transition.guard !== undefined) {
        loopGuards.get(own)?.add(transition.guard);
      }
    }
  }
  const inside = new Map<readonly I["element"][], number[]>();
  for (const entry of entries) {
    const own = component.get(entry.target);
    if (own !== undefined && looping.has(own)) {
      observe?.(1);
      append(inside, own, entry.index);
    }
  }
  for (const [own, element] of looping) {
    const guards = [...(loopGuards.get(own) ?? [])];
    add(element, {
      authored: undefined,
      operands: [
        {
          guard: guards.length > 0 ? guards.join(" or ") : undefined,
          positions: inside.get(own) ?? [],
        },
      ],
      item: derivedItem<I>(element, "loop"),
    });
  }

  /** Each branching element's forward branch count, where they meet, and, for a decision, whether it draws an `opt`: found once per element, not once per step that leaves it. */
  const shapes = new Map<
    I["element"],
    {
      readonly branches: number;
      readonly meet: I["element"] | undefined;
      readonly operator: "alt" | "opt";
    }
  >();
  for (const element of branching) {
    const forward = (outgoing.get(element.id) ?? []).filter(
      (transition) => !loops.has(transition.id),
    );
    const meet = meetOf(element.id);
    const direct = forward.filter((branch) => branch.target === meet).length;
    shapes.set(element.id, {
      branches: forward.length,
      meet,
      operator: forward.length === minBranches && direct === 1 ? "opt" : "alt",
    });
  }
  const decisions = new Set<I["element"]>(
    branching.flatMap((element) =>
      element.kind === "decision" ? [element.id] : [],
    ),
  );

  // Alternatives: occurrences open when a forward branch is taken and close where the branches meet.
  interface Occurrence {
    readonly element: I["element"];
    readonly operator: "alt" | "opt";
    readonly guard: string | undefined;
    readonly start: number;
  }
  const waiting = new Map<I["element"], Occurrence[]>();
  const openAt = new Map<I["element"], Occurrence>();
  const closed = new Set<Occurrence>();
  const close = (occurrence: Occurrence, stop: number): void => {
    if (closed.has(occurrence)) {
      return;
    }
    closed.add(occurrence);
    if (openAt.get(occurrence.element) === occurrence) {
      openAt.delete(occurrence.element);
    }
    if (stop > occurrence.start) {
      add(occurrence.element, {
        authored: undefined,
        operands: [
          { guard: occurrence.guard, from: occurrence.start, to: stop - 1 },
        ],
        item: derivedItem<I>(occurrence.element, occurrence.operator),
      });
    }
  };

  // Parallel branches: a label on each element reached says which branch of which open `par` it is on; reaching the fork's post-dominator hands back the label the fork had.
  interface Parallel {
    readonly element: I["element"];
    readonly meet: I["element"] | undefined;
    readonly outer: Label | undefined;
    readonly operands: {
      readonly guard: string | undefined;
      readonly positions: number[];
    }[];
    readonly taken: Set<I["transition"]>;
  }
  interface Label {
    readonly parallel: Parallel;
    readonly operand: number;
  }
  const labels = new Map<I["element"], Label>();
  const openParallel = new Map<I["element"], Parallel>();
  const parallels: Parallel[] = [];
  /** The label a step carrying `label` leaves on `target`: the enclosing one when `target` is where its `par` meets. */
  const after = (
    label: Label | undefined,
    target: I["element"],
  ): Label | undefined =>
    label?.parallel.meet === target ? label.parallel.outer : label;
  const relabel = (target: I["element"], label: Label | undefined): void => {
    const next = after(label, target);
    if (next === undefined) {
      labels.delete(target);
    } else {
      labels.set(target, next);
    }
  };

  for (const [index, step] of steps.entries()) {
    const { transition } = step;
    const drawn = steps[index + 1]?.before ?? entries.length;
    const position = drawn > step.before ? step.before : undefined;
    const source = transition.source;
    const shape = shapes.get(source);

    if (
      decisions.has(source) &&
      shape !== undefined &&
      shape.branches >= minBranches &&
      !loops.has(transition.id)
    ) {
      const earlier = openAt.get(source);
      if (earlier !== undefined) {
        close(earlier, step.before);
      }
      const { meet, operator } = shape;
      if (!(operator === "opt" && transition.target === meet)) {
        const occurrence: Occurrence = {
          element: source,
          operator,
          guard: transition.guard,
          start: step.before,
        };
        openAt.set(source, occurrence);
        if (meet !== undefined) {
          append(waiting, meet, occurrence);
        }
      }
    }

    let label = labels.get(source);
    if (
      !decisions.has(source) &&
      shape !== undefined &&
      shape.branches >= minBranches
    ) {
      let parallel = openParallel.get(source);
      if (parallel === undefined || parallel.taken.has(transition.id)) {
        parallel = {
          element: source,
          meet: shape.meet,
          outer: label,
          operands: [],
          taken: new Set(),
        };
        openParallel.set(source, parallel);
        parallels.push(parallel);
      }
      parallel.taken.add(transition.id);
      parallel.operands.push({ guard: transition.guard, positions: [] });
      label = { parallel, operand: parallel.operands.length - 1 };
    }
    // The message of a step arriving where its branch's `par` meets lies outside that `par`.
    const holder = after(label, transition.target);
    if (holder !== undefined && position !== undefined) {
      observe?.(1);
      holder.parallel.operands[holder.operand]?.positions.push(position);
    }
    relabel(transition.target, label);

    for (const occurrence of waiting.get(transition.target) ?? []) {
      close(occurrence, step.before);
    }
    waiting.delete(transition.target);
  }
  for (const occurrence of openAt.values()) {
    close(occurrence, entries.length);
  }
  for (const parallel of parallels) {
    add(parallel.element, {
      authored: undefined,
      operands: parallel.operands,
      item: derivedItem<I>(parallel.element, "par"),
    });
  }

  return model.elements.flatMap((element) => found.get(element.id) ?? []);
};

/**
 * The authored fragments as candidates. An operand counts when its body is non-empty and wholly on the path; it holds the messages arriving at an element of its body that no earlier operand of the same fragment holds. The positions arriving at each element are found once and shared by every operand holding that element, so an operand is its elements and their shared lists, and matching costs the messages plus the bodies, never a message once per fragment.
 */
const authoredCandidates = <I extends IdSpace>(
  fragments: readonly Fragment<I["fragment"], I>[],
  entries: readonly Entry<I>[],
  onPath: ReadonlySet<I["element"]>,
  observe: Observe | undefined,
): Candidate<I>[] => {
  // The positions of the messages arriving at each element, found once and shared by every operand whose body holds the element.
  const arrivals = new Map<I["element"], number[]>();
  for (const entry of entries) {
    observe?.(1);
    append(arrivals, entry.target, entry.index);
  }

  return fragments.map(({ id, operator, operands }) => {
    // An element belongs to the first operand of the fragment whose body holds it, so a message is held by that operand only.
    const taken = new Set<I["element"]>();
    const held: Operand[] = [];
    for (const operand of operands) {
      if (
        operand.body.length === 0 ||
        !operand.body.every((element) => onPath.has(element))
      ) {
        continue;
      }
      const elements: {
        readonly element: string;
        readonly positions: readonly number[];
      }[] = [];
      for (const element of operand.body) {
        observe?.(1);
        const positions = arrivals.get(element);
        if (!taken.has(element) && positions !== undefined) {
          elements.push({ element, positions });
        }
        taken.add(element);
      }
      if (elements.length > 0) {
        held.push({ guard: operand.guard, elements });
      }
    }

    return {
      authored: id,
      operands: held,
      item: (drawn): SequenceItem<I> => ({
        kind: "fragment",
        fragment: id,
        operator,
        operands: drawn,
      }),
    };
  });
};

/** A fragment placed in the diagram: its candidate, where its messages run, which operand holds each, and the operand of the fragment it sits in. */
interface Placed<I extends IdSpace> {
  readonly candidate: Candidate<I>;
  readonly first: number;
  readonly last: number;
  readonly slotOf: (position: number) => number;
  readonly parent:
    { readonly placed: Placed<I>; readonly slot: number } | undefined;
  readonly order: number;
}

/** How many of the ascending `positions` lie between `from` and `to` inclusive, by two binary searches. */
const countBetween = (
  positions: readonly number[],
  from: number,
  to: number,
): number => {
  const firstAtLeast = (value: number): number => {
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((positions[middle] ?? value) < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  };

  return firstAtLeast(to + 1) - firstAtLeast(from);
};

/** The first and last position an operand holds and how many it holds, from its ends or its list's ends. */
const extentOf = (
  held: Held,
):
  | { readonly first: number; readonly last: number; readonly count: number }
  | undefined => {
  if (held.elements !== undefined) {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (const { positions } of held.elements) {
      count += positions.length;
      first = Math.min(first, positions[0] ?? first);
      last = Math.max(last, positions.at(-1) ?? last);
    }

    return count === 0 ? undefined : { first, last, count };
  }
  if (held.positions === undefined) {
    return held.to < held.from
      ? undefined
      : { first: held.from, last: held.to, count: held.to - held.from + 1 };
  }
  const first = held.positions[0];
  const last = held.positions.at(-1);

  return first === undefined || last === undefined
    ? undefined
    : { first, last, count: held.positions.length };
};

/** Whether an operand holds every position from `first` to `last`. */
const holdsAll = (held: Held, first: number, last: number): boolean => {
  if (held.elements !== undefined) {
    let count = 0;
    for (const { positions } of held.elements) {
      count += countBetween(positions, first, last);
    }

    return count === last - first + 1;
  }

  return held.positions === undefined
    ? held.from <= first && last <= held.to
    : countBetween(held.positions, first, last) === last - first + 1;
};

/**
 * Which of a fragment's operands holds a position: listed positions are looked up in a map built from the lists, which together hold no more positions than the fragment does, and runs are found by a binary search over their starts. No run is expanded.
 */
const slotIndex = (
  operands: readonly Operand[],
  elementAt: (position: number) => string | undefined,
  observe: Observe | undefined,
): ((position: number) => number) => {
  if (operands.length === 1) {
    return () => 0;
  }
  const listed = new Map<number, number>();
  const byElement = new Map<string, number>();
  const runs: {
    readonly from: number;
    readonly to: number;
    readonly slot: number;
  }[] = [];
  for (const [slot, operand] of operands.entries()) {
    if (operand.elements !== undefined) {
      for (const { element } of operand.elements) {
        observe?.(1);
        byElement.set(element, slot);
      }
      continue;
    }
    if (operand.positions === undefined) {
      runs.push({ from: operand.from, to: operand.to, slot });
      continue;
    }
    for (const position of operand.positions) {
      observe?.(1);
      listed.set(position, slot);
    }
  }
  runs.sort((a, b) => a.from - b.from);

  return (position) => {
    const element = elementAt(position);
    const found =
      listed.get(position) ??
      (element === undefined ? undefined : byElement.get(element));
    if (found !== undefined) {
      return found;
    }
    let low = 0;
    let high = runs.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((runs[middle]?.from ?? position) <= position) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const run = runs[low - 1];

    return run !== undefined && position <= run.to ? run.slot : 0;
  };
};

/**
 * Which placed fragment is innermost at each position, without visiting the positions a fragment covers: fragments are placed largest first, so the innermost at a position is the one placed last among those covering it. A segment tree over the positions records, on the nodes that exactly cover each placed span, when it was placed; the innermost at a position is the latest placement on the path from its leaf to the root. Placing and asking each visit a number of nodes that grows with the logarithm of the number of positions.
 */
const placementTree = (
  size: number,
): {
  readonly place: (first: number, last: number, time: number) => void;
  readonly at: (position: number) => number | undefined;
} => {
  const latest: (number | undefined)[] = Array.from(
    { length: 2 * size },
    () => undefined,
  );

  return {
    place: (first, last, time) => {
      let low = first + size;
      let high = last + size + 1;
      while (low < high) {
        if ((low & 1) === 1) {
          latest[low] = time;
          low += 1;
        }
        if ((high & 1) === 1) {
          high -= 1;
          latest[high] = time;
        }
        low >>>= 1;
        high >>>= 1;
      }
    },
    at: (position) => {
      let best: number | undefined;
      for (let node = position + size; node >= 1; node >>>= 1) {
        const time = latest[node];
        if (time !== undefined && (best === undefined || time > best)) {
          best = time;
        }
      }

      return best;
    },
  };
};

/**
 * Wraps the scenario's messages in the fragments they fall inside: the authored ones first, then those derived from the model's structure.
 *
 * A fragment is drawn when it holds at least one message and the messages it holds are consecutive. Larger fragments are placed first; a fragment nests inside a placed one when all its messages lie in one of that fragment's operands, and is left out when it overlaps one without nesting. A derived fragment holding exactly the messages an authored one holds is not drawn: the authored fragment is the author's notation for the same structure.
 *
 * Fragments are compared and placed by the ends of their spans, and a segment tree answers which placed fragment is innermost at a position, so no span is ever expanded into its positions; the items are then built in one pass over the messages.
 * @param path - The scenario; its `observe`, when given, is told of the work done over message positions.
 * @returns The items and the ids of the authored fragments drawn.
 */
export const wrapFragments = <I extends IdSpace>(
  path: ScenarioPath<I>,
): {
  readonly items: SequenceItem<I>[];
  readonly drawn: Set<I["fragment"]>;
} => {
  const { model, entries, onPath, observe } = path;
  const candidates = [
    ...authoredCandidates(model.fragments, entries, onPath, observe),
    ...deriveCandidates(path),
  ];

  const spans: {
    readonly candidate: Candidate<I>;
    readonly first: number;
    readonly last: number;
    readonly order: number;
  }[] = [];
  const authoredSpans = new Set<string>();
  for (const [order, candidate] of candidates.entries()) {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (const operand of candidate.operands) {
      const extent = extentOf(operand);
      if (extent !== undefined) {
        count += extent.count;
        first = Math.min(first, extent.first);
        last = Math.max(last, extent.last);
      }
    }
    const key = `${String(first)}:${String(last)}`;
    if (count === 0 || last - first + 1 !== count) {
      continue;
    }
    if (candidate.authored !== undefined) {
      authoredSpans.add(key);
    } else if (authoredSpans.has(key)) {
      continue;
    }
    spans.push({ candidate, first, last, order });
  }
  spans.sort(
    (a, b) => b.last - b.first - (a.last - a.first) || a.order - b.order,
  );

  const tree = placementTree(entries.length);
  const placed: Placed<I>[] = [];
  const innermost = (position: number): Placed<I> | undefined => {
    const time = tree.at(position);

    return time === undefined ? undefined : placed[time];
  };
  for (const { candidate, first, last, order } of spans) {
    const outer = innermost(first);
    if (outer !== innermost(last)) {
      continue;
    }
    let parent: Placed<I>["parent"];
    if (outer !== undefined) {
      const slot = outer.slotOf(first);
      const operand = outer.candidate.operands[slot];
      if (operand === undefined || !holdsAll(operand, first, last)) {
        continue;
      }
      parent = { placed: outer, slot };
    }
    const node: Placed<I> = {
      candidate,
      first,
      last,
      slotOf: slotIndex(
        candidate.operands,
        (position) => entries[position]?.target,
        observe,
      ),
      parent,
      order,
    };
    tree.place(first, last, placed.length);
    placed.push(node);
  }

  // Each placed fragment's operands, and the top level, list what lies directly inside them in order: messages, and fragments at the position they start.
  type Content = { readonly entry: Entry<I> } | { readonly placed: Placed<I> };
  const top: Content[] = [];
  const contents = new Map<Placed<I>, Content[][]>(
    placed.map((node) => [node, node.candidate.operands.map(() => [])]),
  );
  const contentOf = (
    holder: { readonly placed: Placed<I>; readonly slot: number } | undefined,
  ): Content[] =>
    holder === undefined
      ? top
      : (contents.get(holder.placed)?.[holder.slot] ?? top);
  const starting = new Map<number, Placed<I>[]>();
  for (const node of placed) {
    append(starting, node.first, node);
  }
  for (const entry of entries) {
    observe?.(1);
    for (const node of starting.get(entry.index) ?? []) {
      contentOf(node.parent).push({ placed: node });
    }
    const owner = innermost(entry.index);
    contentOf(
      owner === undefined
        ? undefined
        : { placed: owner, slot: owner.slotOf(entry.index) },
    ).push({ entry });
  }

  // Inner fragments are placed after the ones they sit in, so building in reverse placement order has every inner item ready before its outer one needs it.
  const built = new Map<Placed<I>, SequenceItem<I>>();
  const itemsOf = (content: readonly Content[]): SequenceItem<I>[] =>
    content.flatMap((part): SequenceItem<I>[] => {
      if ("entry" in part) {
        return [{ kind: "message", message: part.entry.message }];
      }
      const item = built.get(part.placed);

      return item === undefined ? [] : [item];
    });
  const drawn = new Set<I["fragment"]>();
  for (const node of placed.toReversed()) {
    const operands = (contents.get(node) ?? []).map((content, slot) => {
      const guard = node.candidate.operands[slot]?.guard;

      return {
        ...(guard === undefined ? {} : { guard }),
        items: itemsOf(content),
      };
    });
    built.set(node, node.candidate.item(operands));
    if (node.candidate.authored !== undefined) {
      drawn.add(node.candidate.authored);
    }
  }

  return { items: itemsOf(top), drawn };
};
