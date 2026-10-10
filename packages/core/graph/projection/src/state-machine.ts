import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import { chainsFrom, outgoingMap, type Chain } from "./chains.ts";
import { commonLoss, unrepresentedLoss, type Loss } from "./loss.ts";

export interface StateMachineState<I extends IdSpace> {
  readonly id: I["element"];
  readonly label: string;
  readonly role: "initial" | "state" | "final";
}

export interface StateMachineTransition<I extends IdSpace> {
  readonly source: I["element"];
  readonly target: I["element"];
  readonly event?: I["event"];
  readonly guard?: string;
  readonly effect?: I["action"];
  /** The model transitions this transition stands for, in order. An edit to it maps back to the model through these. */
  readonly transitions: readonly I["transition"][];
  /** The elements folded into it, in order: decisions, activities that do not affect the subject, and `message` elements. */
  readonly through?: readonly I["element"][];
}

export interface StateMachine<I extends IdSpace> {
  readonly subject: I["entity"];
  readonly states: readonly StateMachineState<I>[];
  readonly transitions: readonly StateMachineTransition<I>[];
  /** What the projection dropped from the model. */
  readonly loss: readonly Loss<I>[];
}

const stateOf = <I extends IdSpace>(
  element: ElementOf<I>,
): StateMachineState<I> | undefined => {
  switch (element.kind) {
    case "activity":
    case "state":
      return { id: element.id, label: element.label, role: "state" };
    case "pseudo":
      if (element.role === "initial") {
        return { id: element.id, label: "Start", role: "initial" };
      }
      if (element.role === "final") {
        return { id: element.id, label: "End", role: "final" };
      }

      break;
    case "decision":
    case "message":
      break;
  }

  return undefined;
};

/**
 * Activity-as-state projection. Each activity that affects the subject becomes a state the subject entity rests in, and a decision collapses into guarded transitions leaving the state before it. The target activity's action becomes the effect of the transition that enters it.
 *
 * Which activities affect the subject is declared by their `affects`. An activity that does not list the subject is not a state of it: transitions through it are folded into the transition that leaves the previous state, exactly as a decision is. Authored `state` elements and pseudo-states are always kept. When no activity in the model declares `affects`, the model carries no such information and every activity is kept, which is the unscoped behaviour.
 *
 * A `message` element is folded the same way, and its `event`, when it has one, triggers the transition that carries it. A message element no drawn transition carries is reported as a `message-elements` loss.
 *
 * Each drawn transition lists the model `transitions` it stands for and the elements folded into it (`through`), so an edit to it maps back to the model.
 *
 * Decisions are folded into guards by design and are not a loss. Fork, join and history pseudo-states have no state of their own here and are reported as unrepresented, together with the transitions that touch them, which are left out rather than pointing at a state that is not drawn.
 *
 * Other conventions exist, such as steps as transitions with states between them. Naming states such as "Paid" needs authored states, which the model can hold as `state` elements.
 * @param model - The model to project.
 * @param subject - The entity whose lifecycle the machine shows.
 * @returns The states in model order, the transitions leaving each in turn, and what was dropped.
 * @throws Error when `subject` is not a declared entity participant, which only a runtime model can cause.
 */
export const toStateMachine = <I extends IdSpace>(
  model: Model<I>,
  subject: I["entity"],
): StateMachine<I> => {
  // The type already limits `subject` to declared entities. This guards models loaded from JSON.
  const owner = model.participants.find(
    (participant) => participant.id === subject,
  );
  if (owner?.kind !== "entity") {
    throw new Error(
      `State machine subject "${subject}" must be a declared entity participant`,
    );
  }

  const elements = new Map<I["element"], ElementOf<I>>(
    model.elements.map((element) => [element.id, element]),
  );
  const outgoing = outgoingMap(model);

  const scoped = model.elements.some(
    (element) => element.kind === "activity" && element.affects !== undefined,
  );
  /** Whether an element is folded through rather than shown as a state: a decision, a `message` element, or an activity that does not affect the subject in a model that declares what activities affect. */
  const isTransparent = (element: ElementOf<I>): boolean =>
    element.kind === "decision" ||
    element.kind === "message" ||
    (element.kind === "activity" &&
      scoped &&
      element.affects?.includes(subject) !== true);
  const isFolded = (id: I["element"]): boolean => {
    const element = elements.get(id);

    return element !== undefined && isTransparent(element);
  };

  /** The transition a chain draws. The event is the last trigger along it, counting a folded message's own event at its place in the chain; guards are joined in order; the effect is the entry action of the target activity, or else the last effect along the chain. */
  const transitionOf = (
    source: I["element"],
    chain: Chain<I>,
  ): StateMachineTransition<I> => {
    const triggers: I["event"][] = [];
    const guards: string[] = [];
    const effects: I["action"][] = [];
    for (const [index, transition] of chain.transitions.entries()) {
      if (transition.trigger !== undefined) {
        triggers.push(transition.trigger);
      }
      if (transition.guard !== undefined) {
        guards.push(transition.guard);
      }
      if (transition.effect !== undefined) {
        effects.push(transition.effect);
      }
      // `through[index]` is the folded element this transition arrives at; the last transition arrives at the target instead.
      const passed = chain.through[index];
      const folded = passed === undefined ? undefined : elements.get(passed);
      if (folded?.kind === "message" && folded.event !== undefined) {
        triggers.push(folded.event);
      }
    }
    const target = elements.get(chain.target);
    const event = triggers.at(-1);
    const guard = guards.length > 0 ? guards.join(" and ") : undefined;
    const effect =
      (target?.kind === "activity" ? target.action : undefined) ??
      effects.at(-1);

    return {
      source,
      target: chain.target,
      ...(event === undefined ? {} : { event }),
      ...(guard === undefined ? {} : { guard }),
      ...(effect === undefined ? {} : { effect }),
      transitions: chain.transitions.map((transition) => transition.id),
      ...(chain.through.length === 0 ? {} : { through: chain.through }),
    };
  };

  const states: StateMachineState<I>[] = [];
  const stateIds = new Set<I["element"]>();
  const folded = new Set<I["element"]>();
  for (const element of model.elements) {
    if (isTransparent(element)) {
      folded.add(element.id);
    } else if (stateOf<I>(element) !== undefined) {
      stateIds.add(element.id);
    }
  }
  const transitions: StateMachineTransition<I>[] = [];
  for (const element of model.elements) {
    const state = isTransparent(element) ? undefined : stateOf<I>(element);
    if (state === undefined) {
      continue;
    }
    states.push(state);
    for (const transition of outgoing.get(element.id) ?? []) {
      for (const chain of chainsFrom(transition, outgoing, isFolded)) {
        if (stateIds.has(chain.target)) {
          transitions.push(transitionOf(element.id, chain));
        }
      }
    }
  }
  const carried = new Set<I["element"]>(
    transitions.flatMap((transition) => transition.through ?? []),
  );

  const loss: Loss<I>[] = [
    ...commonLoss(model, "stateMachine", {
      fragments: new Set(),
      messages: carried,
    }),
    ...unrepresentedLoss(
      model,
      "stateMachine",
      new Set<I["element"]>([...stateIds, ...folded]),
    ),
  ];
  const skipped = model.elements.filter(
    (element) => element.kind === "activity" && isTransparent(element),
  );
  if (skipped.length > 0) {
    loss.push({
      kind: "subject",
      subject,
      elements: skipped.map((element) => element.id),
    });
  }

  return { subject, states, transitions, loss };
};
