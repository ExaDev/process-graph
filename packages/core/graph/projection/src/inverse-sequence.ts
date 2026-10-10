import type { IdSpace, Model } from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";
import type {
  ElementChange,
  EventChange,
  ModelDiff,
  TransitionChange,
} from "./diff.ts";
import {
  toSequence,
  type SequenceDiagram,
  type SequenceMessage,
} from "./sequence.ts";

/** The changes in the order found, each once: a step a loop repeats yields the same change on every pass. */
const distinct = <T>(changes: readonly T[]): T[] => {
  const seen = new Set<string>();

  return changes.filter((change) => {
    const key = JSON.stringify(change);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
};

/**
 * The inverse of `toSequence`: what an edited sequence diagram changes in the model. A sequence diagram shows one path and leaves out who owns which step, so most of what it implies has to be inferred, and every such change is marked `inferred` until it is confirmed.
 *
 * Messages are matched to the projection by transition id, occurrence by occurrence, since a loop repeats a step. For a matched message:
 *
 * - a changed label renames what the label came from, which is certain: the `message` element it draws, the event that triggers the step, or the step's target element;
 * - changed ends on a `message` element readdress it, which is certain;
 * - a changed receiver relanes the step's target and a changed sender relanes its source, both inferred, since the edit could equally mean a different element.
 *
 * A projected message missing from the edit removes its transition, inferred, since it may only have left this scenario. A message with a new transition id is a new step, inferred: it must name the element it arrives at in `element` (an existing element, or a new activity owned by its receiver, labelled with the message), and it leaves from where the latest earlier message to its sender arrived. When the message after it was a step from that same place, that step is rewired to leave from the new element instead, inferred. Lifelines and items are derived from the messages and not read.
 * @param model - The model the diagram was projected from.
 * @param scenario - The scenario it was projected for.
 * @param edited - The projected diagram after editing.
 * @returns The changes, each listed once.
 * @throws Error when the edit cannot be expressed in the model: a model transition added to the diagram that the scenario does not take (a scenario change, not a model change), a changed `element` on a drawn message, a changed sender on a step whose sender comes from an earlier step, or a new message with no `element` or with no earlier message to its sender.
 */
export const diffSequence = <I extends IdSpace>(
  model: Model<I>,
  scenario: readonly I["transition"][],
  edited: Readonly<Pick<SequenceDiagram<I>, "messages">>,
): ModelDiff<I> => {
  const original = toSequence(model, scenario);
  const transitions = new Map(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  const events = new Map(model.events.map((event) => [event.id, event]));
  const elementIds = new Set<I["element"]>(
    model.elements.map((element) => element.id),
  );
  const actors = actorMap(model);

  const pending = new Map<I["transition"], SequenceMessage<I>[]>();
  for (const message of original.messages) {
    pending.set(message.transition, [
      ...(pending.get(message.transition) ?? []),
      message,
    ]);
  }

  const elementChanges: ElementChange<I>[] = [];
  const transitionChanges: TransitionChange<I>[] = [];
  const eventChanges: EventChange<I>[] = [];
  /** Where each edited message arrives, by position, for placing a new step after it. */
  const arrivals: { readonly actor: I["actor"]; readonly at: I["element"] }[] =
    [];
  /** A new step just placed, and where it left from, so the next drawn step can be rewired after it. */
  let inserted:
    { readonly from: I["element"]; readonly element: I["element"] } | undefined;

  for (const message of edited.messages) {
    const queue = pending.get(message.transition);
    const before = queue?.shift();
    const transition = transitions.get(message.transition);
    if (before === undefined || transition === undefined) {
      if (transition !== undefined) {
        throw new Error(
          `Transition "${message.transition}" is in the model but not on this scenario; a scenario change is not a model change`,
        );
      }
      const target = message.element;
      if (target === undefined) {
        throw new Error(
          `New message "${message.transition}" must name the element it arrives at in \`element\``,
        );
      }
      const source = arrivals.findLast(
        ({ actor }) => actor === message.from,
      )?.at;
      if (source === undefined) {
        throw new Error(
          `New message "${message.transition}" has no earlier message to "${message.from}" to leave from`,
        );
      }
      if (!elementIds.has(target)) {
        elementChanges.push({
          kind: "added",
          element: {
            kind: "activity",
            id: target,
            label: message.label,
            actor: message.to,
          },
          inferred: true,
        });
      }
      transitionChanges.push({
        kind: "added",
        transition: { id: message.transition, source, target },
        inferred: true,
      });
      arrivals.push({ actor: message.to, at: target });
      inserted = { from: source, element: target };
      continue;
    }

    if (message.element !== before.element) {
      throw new Error(
        `Message "${message.transition}" draws "${String(before.element)}"; which element a drawn message is cannot be edited`,
      );
    }
    if (inserted?.from === transition.source) {
      transitionChanges.push({
        kind: "rewired",
        transition: transition.id,
        from: { source: transition.source, target: transition.target },
        to: { source: inserted.element, target: transition.target },
        inferred: true,
      });
    }
    inserted = undefined;
    arrivals.push({
      actor: message.to,
      at: before.element ?? transition.target,
    });

    if (before.label !== message.label) {
      const trigger =
        transition.trigger === undefined
          ? undefined
          : events.get(transition.trigger);
      if (before.element !== undefined) {
        elementChanges.push({
          kind: "renamed",
          element: before.element,
          from: before.label,
          to: message.label,
          inferred: false,
        });
      } else if (trigger === undefined) {
        elementChanges.push({
          kind: "renamed",
          element: transition.target,
          from: before.label,
          to: message.label,
          inferred: false,
        });
      } else {
        eventChanges.push({
          kind: "renamed",
          event: trigger.id,
          from: trigger.name,
          to: message.label,
          inferred: false,
        });
      }
    }

    if (before.element !== undefined) {
      if (before.from !== message.from || before.to !== message.to) {
        elementChanges.push({
          kind: "readdressed",
          element: before.element,
          from: { from: before.from, to: before.to },
          to: { from: message.from, to: message.to },
          inferred: false,
        });
      }
      continue;
    }
    if (before.to !== message.to) {
      elementChanges.push({
        kind: "relaned",
        element: transition.target,
        from: before.to,
        to: message.to,
        inferred: true,
      });
    }
    if (before.from !== message.from) {
      if (actors.get(transition.source) === undefined) {
        throw new Error(
          `The sender of "${message.transition}" is whoever reached "${transition.source}"; change the earlier step instead`,
        );
      }
      elementChanges.push({
        kind: "relaned",
        element: transition.source,
        from: before.from,
        to: message.from,
        inferred: true,
      });
    }
  }

  for (const [transition, left] of pending) {
    if (left.length > 0) {
      transitionChanges.push({ kind: "removed", transition, inferred: true });
    }
  }

  return {
    elements: distinct(elementChanges),
    transitions: distinct(transitionChanges),
    events: distinct(eventChanges),
  };
};
