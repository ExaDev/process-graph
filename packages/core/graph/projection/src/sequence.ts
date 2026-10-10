import type { IdSpace, Model, Transition } from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";

export interface SequenceMessage<I extends IdSpace> {
  readonly transition: I["transition"];
  readonly from: I["actor"];
  /** Equal to `from` for a self-message. */
  readonly to: I["actor"];
  readonly label: string;
}

export interface SequenceDiagram<I extends IdSpace> {
  /** Actors in order of first appearance. */
  readonly lifelines: readonly I["actor"][];
  readonly messages: readonly SequenceMessage<I>[];
}

/**
 * One path through the process as messages. A step between two elements with actors becomes a message, labelled by the transition's event when it has one and by the target's label otherwise. Steps touching an element with no actor are skipped. Branches off the path are not drawn, which is why this direction is lossy and one-to-many.
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

  const lifelines: I["actor"][] = [];
  const messages: SequenceMessage<I>[] = [];
  for (const id of scenario) {
    const transition = transitions.get(id);
    if (transition === undefined) {
      throw new Error(`Scenario step "${id}" is not a declared transition`);
    }
    const from = actors.get(transition.source);
    const to = actors.get(transition.target);
    if (from === undefined || to === undefined) {
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
    messages.push({
      transition: id,
      from,
      to,
      label: eventName ?? labels.get(transition.target) ?? id,
    });
  }

  return { lifelines, messages };
};
