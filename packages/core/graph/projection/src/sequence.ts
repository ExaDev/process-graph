import type {
  FragmentOperator,
  IdSpace,
  MessageMode,
  Model,
  Transition,
} from "@exadev/process-graph-schema";
import { actorMap, type ElementOf } from "./actors.ts";
import { wrapFragments, type Entry, type Step } from "./fragments.ts";
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
  const steps: Step<I>[] = [];
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
    steps.push({ transition, before: entries.length });
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

  const { items, drawn } = wrapFragments(model, steps, entries, onPath);

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
