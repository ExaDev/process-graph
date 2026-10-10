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

/** A fragment that may be drawn, with the positions of the messages each of its operands holds, each list ascending and the lists disjoint. */
interface Candidate<I extends IdSpace> {
  /** The authored fragment's id; absent for a derived fragment. */
  readonly authored: I["fragment"] | undefined;
  readonly operands: readonly {
    readonly guard: string | undefined;
    readonly positions: readonly number[];
  }[];
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

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, offset) => from + offset);

/**
 * The fragments the model's structure implies along the scenario, in model order of the decision or fork each comes from, each decision's loop before its other fragments.
 *
 * - A decision transition whose target is in the decision's strongly connected component goes round again, the rule `graph-domain` uses for a legal cycle. Each component holding such a decision on the path draws one `loop`, holding the messages that arrive inside the component, guarded by those transitions' guards joined with "or".
 * - Each time the path takes one of a decision's other (forward) branches, when it has at least two, an `alt` holds the messages from that step until the path reaches where the branches meet: the decision's immediate post-dominator over forward transitions, or the end of the path when they never meet. With exactly two branches, one going straight to where they meet, it is an `opt`, and taking that empty branch draws nothing. The path coming back to the decision ends the earlier occurrence.
 * - Each time the path leaves a fork, a `par` holds one operand per branch taken, each with the messages of the steps that follow on from that branch until it reaches the fork's immediate post-dominator; a branch taken again starts a new `par`.
 *
 * One pass finds every component and one pass every post-dominator, both only when the path passes a decision or fork, and the path is then read once, so the work is the size of the model and of the path, not their product.
 */
const deriveCandidates = <I extends IdSpace>(
  model: Model<I>,
  steps: readonly Step<I>[],
  entries: readonly Entry<I>[],
  onPath: ReadonlySet<I["element"]>,
): Candidate<I>[] => {
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

  const forwardCount = new Map<I["element"], readonly TransitionOf<I>[]>();
  for (const element of branching) {
    forwardCount.set(
      element.id,
      (outgoing.get(element.id) ?? []).filter(
        (transition) => !loops.has(transition.id),
      ),
    );
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
          { guard: occurrence.guard, positions: range(occurrence.start, stop) },
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
    const forward = forwardCount.get(source);

    if (
      decisions.has(source) &&
      forward !== undefined &&
      forward.length >= minBranches &&
      !loops.has(transition.id)
    ) {
      const earlier = openAt.get(source);
      if (earlier !== undefined) {
        close(earlier, step.before);
      }
      const meet = meetOf(source);
      const direct = forward.filter((branch) => branch.target === meet);
      const operator =
        forward.length === minBranches && direct.length === 1 ? "opt" : "alt";
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
      forward !== undefined &&
      forward.length >= minBranches
    ) {
      let parallel = openParallel.get(source);
      if (parallel === undefined || parallel.taken.has(transition.id)) {
        parallel = {
          element: source,
          meet: meetOf(source),
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
 * The authored fragments as candidates. An operand counts when its body is non-empty and wholly on the path; it holds the messages arriving at an element of its body that no earlier operand of the same fragment holds. Bodies are indexed by element once, so each message is matched only against the operands whose body holds the element it arrives at.
 */
const authoredCandidates = <I extends IdSpace>(
  fragments: readonly Fragment<I["fragment"], I>[],
  entries: readonly Entry<I>[],
  onPath: ReadonlySet<I["element"]>,
): Candidate<I>[] => {
  const operands = fragments.map((fragment) =>
    fragment.operands.map(
      (
        operand,
      ): {
        readonly guard: string | undefined;
        readonly positions: number[];
        readonly counts: boolean;
      } => ({
        guard: operand.guard,
        positions: [],
        counts:
          operand.body.length > 0 && operand.body.every((id) => onPath.has(id)),
      }),
    ),
  );
  const holders = new Map<
    I["element"],
    { readonly fragment: number; readonly operand: number }[]
  >();
  for (const [fragment, { operands: authored }] of fragments.entries()) {
    for (const [operand, { body }] of authored.entries()) {
      if (operands[fragment]?.[operand]?.counts !== true) {
        continue;
      }
      for (const id of new Set(body)) {
        append(holders, id, { fragment, operand });
      }
    }
  }
  for (const entry of entries) {
    let previous = -1;
    for (const { fragment, operand } of holders.get(entry.target) ?? []) {
      if (fragment !== previous) {
        previous = fragment;
        operands[fragment]?.[operand]?.positions.push(entry.index);
      }
    }
  }

  return fragments.map(({ id, operator }, fragment) => ({
    authored: id,
    operands: (operands[fragment] ?? []).filter(
      ({ positions }) => positions.length > 0,
    ),
    item: (drawn): SequenceItem<I> => ({
      kind: "fragment",
      fragment: id,
      operator,
      operands: drawn,
    }),
  }));
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

/**
 * Wraps the scenario's messages in the fragments they fall inside: the authored ones first, then those derived from the model's structure.
 *
 * A fragment is drawn when it holds at least one message and the messages it holds are consecutive. Larger fragments are placed first; a fragment nests inside a placed one when all its messages lie in one of that fragment's operands, and is left out when it overlaps one without nesting. A derived fragment holding exactly the messages an authored one holds is not drawn: the authored fragment is the author's notation for the same structure.
 *
 * Each position records the innermost fragment placed over it, so placing a fragment reads its two ends and writes its own span, and the items are then built in one pass over the positions; the work is the number of messages times the depth fragments nest to.
 * @returns The items and the ids of the authored fragments drawn.
 */
export const wrapFragments = <I extends IdSpace>(
  model: Model<I>,
  steps: readonly Step<I>[],
  entries: readonly Entry<I>[],
  onPath: ReadonlySet<I["element"]>,
): {
  readonly items: SequenceItem<I>[];
  readonly drawn: Set<I["fragment"]>;
} => {
  const candidates = [
    ...authoredCandidates(model.fragments, entries, onPath),
    ...deriveCandidates(model, steps, entries, onPath),
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
    for (const { positions } of candidate.operands) {
      count += positions.length;
      const head = positions[0];
      const tail = positions.at(-1);
      if (head !== undefined && tail !== undefined) {
        first = Math.min(first, head);
        last = Math.max(last, tail);
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

  const innermost: (Placed<I> | undefined)[] = entries.map(() => undefined);
  const placed: Placed<I>[] = [];
  for (const { candidate, first, last, order } of spans) {
    const outer = innermost[first];
    if (outer !== innermost[last]) {
      continue;
    }
    let parent: Placed<I>["parent"];
    if (outer !== undefined) {
      const slot = outer.slotOf(first);
      const positions = outer.candidate.operands[slot]?.positions ?? [];
      if (countBetween(positions, first, last) !== last - first + 1) {
        continue;
      }
      parent = { placed: outer, slot };
    }
    const owners = new Map<number, number>();
    if (candidate.operands.length > 1) {
      for (const [slot, { positions }] of candidate.operands.entries()) {
        for (const position of positions) {
          owners.set(position, slot);
        }
      }
    }
    const node: Placed<I> = {
      candidate,
      first,
      last,
      slotOf: (position) => owners.get(position) ?? 0,
      parent,
      order,
    };
    placed.push(node);
    for (let position = first; position <= last; position += 1) {
      innermost[position] = node;
    }
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
    for (const node of starting.get(entry.index) ?? []) {
      contentOf(node.parent).push({ placed: node });
    }
    const owner = innermost[entry.index];
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
