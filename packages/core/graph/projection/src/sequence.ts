import type {
  FragmentOperator,
  IdSpace,
  MessageMode,
  Model,
  Transition,
} from "@exadev/process-graph-schema";
import { actorMap, type ElementOf } from "./actors.ts";
import { deriveFragments } from "./derived-fragments.ts";
import { commonLoss, type Loss } from "./loss.ts";

export interface SequenceMessage<I extends IdSpace> {
  readonly transition: I["transition"];
  readonly from: I["actor"];
  /** Equal to `from` for a self-message. */
  readonly to: I["actor"];
  readonly label: string;
  /** The `message` element drawn, when the step arrives at one; its `from`, `to`, `label` and `mode` are the message's own. In an edited diagram passed to `diffSequence`, a new message names here the element it arrives at instead. */
  readonly element?: I["element"];
  /** How the message is sent, when it is a `message` element's. A step between two activities has no mode of its own. */
  readonly mode?: MessageMode;
}

/** One operand of an emitted fragment: the operand's guard, when it has one, and what happens inside it. */
export interface SequenceOperand<I extends IdSpace> {
  readonly guard?: string;
  readonly items: readonly SequenceItem<I>[];
}

/** What every drawn fragment carries, authored or derived. */
interface FragmentItem<I extends IdSpace> {
  readonly kind: "fragment";
  readonly operator: FragmentOperator;
  /** The operands the scenario takes, in authored or branch order. */
  readonly operands: readonly SequenceOperand<I>[];
}

/** A message, or a fragment wrapping the messages of the scenario that fall inside it: an authored one, named by `fragment`, or one derived from the decision or fork named by `element`. */
export type SequenceItem<I extends IdSpace> =
  | { readonly kind: "message"; readonly message: SequenceMessage<I> }
  | (FragmentItem<I> & {
      readonly fragment: I["fragment"];
      readonly element?: never;
    })
  | (FragmentItem<I> & {
      readonly element: I["element"];
      readonly fragment?: never;
    });

export interface SequenceDiagram<I extends IdSpace> {
  /** Actors in order of first appearance. */
  readonly lifelines: readonly I["actor"][];
  /** Every message in scenario order, including those inside fragments. */
  readonly messages: readonly SequenceMessage<I>[];
  /** The same messages, with authored and derived fragments wrapped around the ones that fall inside them. */
  readonly items: readonly SequenceItem<I>[];
  /** What the projection dropped from the model. */
  readonly loss: readonly Loss<I>[];
}

/** A scenario message with its position and the element it arrives at. */
interface Entry<I extends IdSpace> {
  readonly index: number;
  readonly message: SequenceMessage<I>;
  readonly target: I["element"];
}

interface TakenOperand<I extends IdSpace> {
  readonly guard: string | undefined;
  readonly entries: readonly Entry<I>[];
  /** The scenario positions of `entries`, for constant-time membership. */
  readonly indices: ReadonlySet<number>;
}

/** A place fragments are drawn into: the top level, or one operand of another fragment. */
interface Container<I extends IdSpace> {
  readonly children: Placed<I>[];
}

/** A fragment that may be drawn: authored or derived. */
interface Candidate<I extends IdSpace> {
  /** The authored fragment's id; absent for a derived fragment. */
  readonly authored: I["fragment"] | undefined;
  /** Builds the item drawn for it from the operands the scenario takes. */
  readonly item: (operands: readonly SequenceOperand<I>[]) => SequenceItem<I>;
  readonly operands: readonly {
    readonly guard?: string | undefined;
    readonly body: readonly I["element"][];
  }[];
}

/** A fragment the scenario passes through, with a container for the fragments nested inside each of its operands. */
interface Placed<I extends IdSpace> {
  readonly candidate: Candidate<I>;
  readonly operands: readonly TakenOperand<I>[];
  readonly indices: ReadonlySet<number>;
  readonly nested: readonly Container<I>[];
}

/** Whether two sets of message positions are the same. */
const sameIndices = (
  first: ReadonlySet<number>,
  second: ReadonlySet<number>,
): boolean =>
  first.size === second.size && [...first].every((index) => second.has(index));

/**
 * Wraps the scenario's messages in the fragments they fall inside: the authored ones first, then those derived from the model's structure.
 *
 * A fragment is drawn when at least one of its operands has a body that lies wholly on the scenario path and receives at least one message, and when the messages it holds are consecutive in the scenario. Only the operands the scenario takes are drawn, in their own order. A fragment whose messages overlap another's without nesting, or are interleaved with messages outside it, is not drawn, because drawing it would reorder or misrepresent the scenario. A derived fragment holding exactly the messages an authored one holds is not drawn either: the authored fragment is the author's notation for the same structure.
 *
 * A message belongs to an operand when the element it arrives at is in that operand's body.
 */
const wrapFragments = <I extends IdSpace>(
  fragments: readonly Candidate<I>[],
  entries: readonly Entry<I>[],
  onPath: ReadonlySet<I["element"]>,
): {
  readonly items: SequenceItem<I>[];
  readonly drawn: Set<I["fragment"]>;
} => {
  const candidates: Placed<I>[] = [];
  for (const fragment of fragments) {
    const claimed = new Set<number>();
    const operands: TakenOperand<I>[] = [];
    for (const operand of fragment.operands) {
      if (
        operand.body.length === 0 ||
        !operand.body.every((id) => onPath.has(id))
      ) {
        continue;
      }
      const body = new Set<I["element"]>(operand.body);
      const inside = entries.filter(
        (entry) => body.has(entry.target) && !claimed.has(entry.index),
      );
      if (inside.length === 0) {
        continue;
      }
      for (const entry of inside) {
        claimed.add(entry.index);
      }
      operands.push({
        guard: operand.guard,
        entries: inside,
        indices: new Set(inside.map((entry) => entry.index)),
      });
    }
    // A fold rather than a spread into Math.min and Math.max, which would pass every position as an argument.
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const index of claimed) {
      first = Math.min(first, index);
      last = Math.max(last, index);
    }
    const duplicate =
      fragment.authored === undefined &&
      candidates.some(
        (placed) =>
          placed.candidate.authored !== undefined &&
          sameIndices(placed.indices, claimed),
      );
    if (
      operands.length > 0 &&
      last - first + 1 === claimed.size &&
      !duplicate
    ) {
      candidates.push({
        candidate: fragment,
        operands,
        indices: claimed,
        nested: operands.map(() => ({ children: [] })),
      });
    }
  }

  // Largest first, so a fragment nests inside any larger one that holds all its messages.
  const bySize = candidates.toSorted((a, b) => b.indices.size - a.indices.size);
  const top: Container<I> = { children: [] };
  // Descends into the operand of the first overlapping fragment that holds all of `node`'s messages; an overlap no operand holds is not drawn.
  const place = (node: Placed<I>): void => {
    const positions = [...node.indices];
    for (
      let container: Container<I> | undefined = top;
      container !== undefined;
    ) {
      const sibling: Placed<I> | undefined = container.children.find((child) =>
        positions.some((index) => child.indices.has(index)),
      );
      if (sibling === undefined) {
        container.children.push(node);

        return;
      }
      const slot: number = sibling.operands.findIndex((operand) =>
        positions.every((index) => operand.indices.has(index)),
      );
      container = slot === -1 ? undefined : sibling.nested[slot];
    }
  };
  for (const node of bySize) {
    place(node);
  }

  const drawn = new Set<I["fragment"]>();
  const itemsOf = (
    inside: readonly Entry<I>[],
    nodes: readonly Placed<I>[],
  ): SequenceItem<I>[] => {
    const items: SequenceItem<I>[] = [];
    const emitted = new Set<Placed<I>>();
    for (const entry of inside) {
      const owner = nodes.find((node) => node.indices.has(entry.index));
      if (owner === undefined) {
        items.push({ kind: "message", message: entry.message });
      } else if (!emitted.has(owner)) {
        emitted.add(owner);
        if (owner.candidate.authored !== undefined) {
          drawn.add(owner.candidate.authored);
        }
        items.push(
          owner.candidate.item(
            owner.operands.map((operand, slot) => ({
              ...(operand.guard === undefined ? {} : { guard: operand.guard }),
              items: itemsOf(
                operand.entries,
                owner.nested[slot]?.children ?? [],
              ),
            })),
          ),
        );
      }
    }

    return items;
  };

  return { items: itemsOf(entries, top.children), drawn };
};

/**
 * One path through the process as messages.
 *
 * A step between two elements with actors becomes a message, labelled by the transition's event when it has one and by the target's label otherwise. A step arriving at a `message` element draws that message, with its own `from`, `to`, `label` and `mode`, and the step leaving it continues the same message rather than drawing another. An element with no actor that the scenario passes through, such as a fork or join, passes on whoever reached it: a step leaving it is sent by the actor of the step that arrived. A step that still has no sender, or that arrives at an element with no actor, draws nothing and is reported as `skipped-steps`. Branches off the path are not drawn, which is why this direction is lossy and one-to-many.
 *
 * `messages` is the flat list. `items` is the same messages with fragments wrapped around the ones that fall inside them: the authored `fragments` the scenario passes through, and those its structure implies (an `alt` or `opt` at a decision, a `loop` back through a decision, a `par` at a fork), each derived fragment naming the decision or fork it comes from. A fragment that cannot be drawn faithfully is left out, and an authored one left out is reported in `loss`.
 * @param model - The model to project.
 * @param scenario - The transitions the path takes, in order.
 * @returns Lifelines in order of first appearance, the messages, the items and what was dropped.
 * @throws Error when a scenario step is not a declared transition.
 */
export const toSequence = <I extends IdSpace>(
  model: Model<I>,
  scenario: readonly I["transition"][],
): SequenceDiagram<I> => {
  const actors = actorMap(model);
  const elements = new Map<I["element"], ElementOf<I>>(
    model.elements.map((element) => [element.id, element]),
  );
  const transitions = new Map<I["transition"], Transition<I["transition"], I>>(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  const eventNames = new Map<I["event"], string>(
    model.events.map((event) => [event.id, event.name]),
  );
  const labelOf = (id: I["element"]): string | undefined => {
    const element = elements.get(id);

    return element?.kind === "activity" || element?.kind === "decision"
      ? element.label
      : undefined;
  };

  const skipped: I["transition"][] = [];
  const lifelines: I["actor"][] = [];
  const onLifeline = new Set<I["actor"]>();
  const messages: SequenceMessage<I>[] = [];
  const entries: Entry<I>[] = [];
  const shownMessages = new Set<I["element"]>();
  // The actor holding control at each element the scenario has reached, so a step leaving an element with no actor has a sender.
  const holder = new Map<I["element"], I["actor"]>();
  let arrivedAt: I["element"] | undefined;
  const draw = (message: SequenceMessage<I>, target: I["element"]): void => {
    for (const participant of [message.from, message.to]) {
      if (!onLifeline.has(participant)) {
        onLifeline.add(participant);
        lifelines.push(participant);
      }
    }
    entries.push({ index: messages.length, message, target });
    messages.push(message);
  };
  for (const id of scenario) {
    const transition = transitions.get(id);
    if (transition === undefined) {
      throw new Error(`Scenario step "${id}" is not a declared transition`);
    }
    const source = elements.get(transition.source);
    const target = elements.get(transition.target);
    const previous = arrivedAt;
    arrivedAt = transition.target;
    if (target?.kind === "message") {
      shownMessages.add(target.id);
      holder.set(target.id, target.to);
      draw(
        {
          transition: id,
          from: target.from,
          to: target.to,
          label: target.label,
          element: target.id,
          mode: target.mode,
        },
        target.id,
      );
      continue;
    }
    if (source?.kind === "message") {
      if (previous !== source.id) {
        shownMessages.add(source.id);
        draw(
          {
            transition: id,
            from: source.from,
            to: source.to,
            label: source.label,
            element: source.id,
            mode: source.mode,
          },
          source.id,
        );
      }
      const to = actors.get(transition.target);
      holder.set(transition.target, to ?? source.to);
      continue;
    }
    const from = actors.get(transition.source) ?? holder.get(transition.source);
    const to = actors.get(transition.target);
    const held = to ?? from;
    if (held !== undefined) {
      holder.set(transition.target, held);
    }
    if (from === undefined || to === undefined) {
      skipped.push(id);
      continue;
    }
    const eventName =
      transition.trigger === undefined
        ? undefined
        : eventNames.get(transition.trigger);
    draw(
      {
        transition: id,
        from,
        to,
        label: eventName ?? labelOf(transition.target) ?? id,
      },
      transition.target,
    );
  }

  const onPath = new Set<I["element"]>();
  const taken = new Set<I["transition"]>(scenario);
  for (const id of taken) {
    const transition = transitions.get(id);
    if (transition !== undefined) {
      onPath.add(transition.source);
      onPath.add(transition.target);
    }
  }
  const offPath = model.elements.filter((element) => !onPath.has(element.id));
  const unshown = model.transitions.filter(
    (transition) => !taken.has(transition.id) && onPath.has(transition.source),
  );

  const candidates: Candidate<I>[] = [
    ...model.fragments.map(({ id, operator, operands }): Candidate<I> => ({
      authored: id,
      operands,
      item: (drawnOperands) => ({
        kind: "fragment",
        fragment: id,
        operator,
        operands: drawnOperands,
      }),
    })),
    ...deriveFragments(model, onPath).map(
      ({ element, operator, operands }): Candidate<I> => ({
        authored: undefined,
        operands,
        item: (drawnOperands) => ({
          kind: "fragment",
          element,
          operator,
          operands: drawnOperands,
        }),
      }),
    ),
  ];
  const { items, drawn } = wrapFragments(candidates, entries, onPath);

  const loss: Loss<I>[] = [
    ...commonLoss(model, "sequence", {
      fragments: drawn,
      messages: shownMessages,
    }),
  ];
  if (offPath.length > 0) {
    loss.push({
      kind: "scenario",
      elements: offPath.map((element) => element.id),
    });
  }
  if (unshown.length > 0) {
    loss.push({
      kind: "unshown-branches",
      transitions: unshown.map((transition) => transition.id),
    });
  }

  if (skipped.length > 0) {
    loss.push({ kind: "skipped-steps", transitions: skipped });
  }

  return { lifelines, messages, items, loss };
};
