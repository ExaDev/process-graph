import type {
  Fragment,
  FragmentOperator,
  IdSpace,
  Model,
  Transition,
} from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";
import { commonLoss, type Loss } from "./loss.ts";

export interface SequenceMessage<I extends IdSpace> {
  readonly transition: I["transition"];
  readonly from: I["actor"];
  /** Equal to `from` for a self-message. */
  readonly to: I["actor"];
  readonly label: string;
}

/** One operand of an emitted fragment: the operand's guard, when it has one, and what happens inside it. */
export interface SequenceOperand<I extends IdSpace> {
  readonly guard?: string;
  readonly items: readonly SequenceItem<I>[];
}

/** A message, or an authored fragment wrapping the messages of the scenario that fall inside it. */
export type SequenceItem<I extends IdSpace> =
  | { readonly kind: "message"; readonly message: SequenceMessage<I> }
  | {
      readonly kind: "fragment";
      readonly fragment: I["fragment"];
      readonly operator: FragmentOperator;
      /** The operands the scenario takes, in authored order. */
      readonly operands: readonly SequenceOperand<I>[];
    };

export interface SequenceDiagram<I extends IdSpace> {
  /** Actors in order of first appearance. */
  readonly lifelines: readonly I["actor"][];
  /** Every message in scenario order, including those inside fragments. */
  readonly messages: readonly SequenceMessage<I>[];
  /** The same messages, with authored fragments wrapped around the ones that fall inside them. */
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
}

/** A place fragments are drawn into: the top level, or one operand of another fragment. */
interface Container<I extends IdSpace> {
  readonly children: Placed<I>[];
}

/** An authored fragment the scenario passes through, with a container for the fragments nested inside each of its operands. */
interface Placed<I extends IdSpace> {
  readonly fragment: Fragment<I["fragment"], I>;
  readonly operands: readonly TakenOperand<I>[];
  readonly indices: ReadonlySet<number>;
  readonly nested: readonly Container<I>[];
}

/**
 * Wraps the scenario's messages in the authored fragments they fall inside.
 *
 * A fragment is drawn when at least one of its operands has a body that lies wholly on the scenario path and receives at least one message, and when the messages it holds are consecutive in the scenario. Only the operands the scenario takes are drawn, in authored order. A fragment whose messages overlap another's without nesting, or are interleaved with messages outside it, is not drawn, because drawing it would reorder or misrepresent the scenario. Fragments are never invented: every one drawn is authored.
 *
 * A message belongs to an operand when the element it arrives at is in that operand's body.
 */
const wrapFragments = <I extends IdSpace>(
  fragments: readonly Fragment<I["fragment"], I>[],
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
      const inside = entries.filter(
        (entry) =>
          operand.body.includes(entry.target) && !claimed.has(entry.index),
      );
      if (inside.length === 0) {
        continue;
      }
      for (const entry of inside) {
        claimed.add(entry.index);
      }
      operands.push({ guard: operand.guard, entries: inside });
    }
    const first = Math.min(...claimed);
    const last = Math.max(...claimed);
    if (operands.length > 0 && last - first + 1 === claimed.size) {
      candidates.push({
        fragment,
        operands,
        indices: claimed,
        nested: operands.map(() => ({ children: [] })),
      });
    }
  }

  // Largest first, so a fragment nests inside any larger one that holds all its messages.
  const bySize = candidates.toSorted((a, b) => b.indices.size - a.indices.size);
  const top: Container<I> = { children: [] };
  const place = (node: Placed<I>, container: Container<I>): void => {
    for (const sibling of container.children) {
      const shared = [...node.indices].filter((index) =>
        sibling.indices.has(index),
      );
      if (shared.length === 0) {
        continue;
      }
      const slot = sibling.operands.findIndex((operand) =>
        [...node.indices].every((index) =>
          operand.entries.some((entry) => entry.index === index),
        ),
      );
      const inner = slot === -1 ? undefined : sibling.nested[slot];
      if (inner !== undefined) {
        place(node, inner);
      }

      return;
    }
    container.children.push(node);
  };
  for (const node of bySize) {
    place(node, top);
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
        drawn.add(owner.fragment.id);
        items.push({
          kind: "fragment",
          fragment: owner.fragment.id,
          operator: owner.fragment.operator,
          operands: owner.operands.map((operand, slot) => ({
            ...(operand.guard === undefined ? {} : { guard: operand.guard }),
            items: itemsOf(operand.entries, owner.nested[slot]?.children ?? []),
          })),
        });
      }
    }

    return items;
  };

  return { items: itemsOf(entries, top.children), drawn };
};

/**
 * One path through the process as messages. A step between two elements with actors becomes a message, labelled by the transition's event when it has one and by the target's label otherwise. Steps touching an element with no actor are skipped and reported as `skipped-steps`. Branches off the path are not drawn, which is why this direction is lossy and one-to-many.
 
`messages` is the flat list. `items` is the same messages with the authored fragments the scenario passes through wrapped around the ones that fall inside them; a fragment that cannot be drawn faithfully is left out and reported in `loss`.
 */
export const toSequence = <I extends IdSpace>(
  model: Model<I>,
  scenario: readonly I["transition"][],
): SequenceDiagram<I> => {
  const actors = actorMap(model);
  const labels = new Map<I["element"], string>();
  for (const element of model.elements) {
    if (element.kind === "activity" || element.kind === "decision") {
      labels.set(element.id, element.label);
    }
  }
  const transitions = new Map<I["transition"], Transition<I["transition"], I>>(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  const eventNames = new Map<I["event"], string>(
    model.events.map((event) => [event.id, event.name]),
  );

  const skipped: I["transition"][] = [];
  const lifelines: I["actor"][] = [];
  const messages: SequenceMessage<I>[] = [];
  const entries: Entry<I>[] = [];
  for (const id of scenario) {
    const transition = transitions.get(id);
    if (transition === undefined) {
      throw new Error(`Scenario step "${id}" is not a declared transition`);
    }
    const from = actors.get(transition.source);
    const to = actors.get(transition.target);
    if (from === undefined || to === undefined) {
      skipped.push(id);
      continue;
    }
    for (const participant of [from, to]) {
      if (!lifelines.includes(participant)) {
        lifelines.push(participant);
      }
    }
    const eventName =
      transition.trigger === undefined
        ? undefined
        : eventNames.get(transition.trigger);
    const message: SequenceMessage<I> = {
      transition: id,
      from,
      to,
      label: eventName ?? labels.get(transition.target) ?? id,
    };
    entries.push({
      index: messages.length,
      message,
      target: transition.target,
    });
    messages.push(message);
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

  const { items, drawn } = wrapFragments(model.fragments, entries, onPath);

  const loss: Loss<I>[] = [...commonLoss(model, "sequence", drawn)];
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
