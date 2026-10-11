import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import {
  chainIndex,
  once,
  outgoingMap,
  type Chain,
  type ChainIndex,
  type TransitionOf,
} from "./chains.ts";
import type { EdgeOrigin } from "./flowchart.ts";
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
  /** The model transitions this transition stands for: one, or every transition on some route through the elements folded into it, each once, in the order they were met. An edit to it maps back to the model through these. */
  readonly transitions: readonly I["transition"][];
  /** The elements folded into it, each once, in the order they were met: decisions, activities that do not affect the subject, and `message` elements. */
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

/** A state machine with what its inverse needs beside it: each transition's origin, in transition order, and the chain index. */
export interface StateMachineParts<I extends IdSpace> {
  readonly machine: StateMachine<I>;
  readonly origins: readonly EdgeOrigin<I>[];
  readonly index: ChainIndex<I>;
}

/**
 * The state machine and the parts its inverse needs; see `toStateMachine`.
 * @param model - The model to project.
 * @param subject - The entity whose lifecycle the machine shows.
 */
export const stateMachineParts = <I extends IdSpace>(
  model: Model<I>,
  subject: I["entity"],
): StateMachineParts<I> => {
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

  /** The transition a chain draws. On a single route, the event is the last trigger along it, counting a folded message's own event right after the transition that arrives at it; guards are joined in order; the effect is the entry action of the target activity, or else the last effect along the route. Where several routes are merged their triggers, guards and effects belong to different routes, so only the target's entry action is kept. A transition through folded elements builds its lists and guard only when they are read. */
  const transitionOf = (chain: Chain<I>): StateMachineTransition<I> => {
    const target = elements.get(chain.target);
    const event = chain.trigger;
    const effect =
      (target?.kind === "activity" ? target.action : undefined) ?? chain.effect;
    const base = {
      source: chain.first.source,
      target: chain.target,
      ...(event === undefined ? {} : { event }),
      ...(effect === undefined ? {} : { effect }),
    };
    if (chain.first.target === chain.target) {
      const { guard } = chain.first;

      return {
        ...base,
        ...(guard === undefined ? {} : { guard }),
        transitions: [chain.first.id],
      };
    }
    const ids = once(() =>
      chain.transitions().map((transition) => transition.id),
    );
    const guard = once(() => chain.guards().join(" and "));

    return chain.guarded
      ? {
          ...base,
          get guard(): string {
            return guard();
          },
          get transitions(): readonly I["transition"][] {
            return ids();
          },
          get through(): readonly I["element"][] {
            return chain.through();
          },
        }
      : {
          ...base,
          get transitions(): readonly I["transition"][] {
            return ids();
          },
          get through(): readonly I["element"][] {
            return chain.through();
          },
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
  const index = chainIndex(model, {
    folded: (id) => folded.has(id),
    accepted: (id) => stateIds.has(id),
    eventOf: (id) => {
      const element = elements.get(id);

      return element?.kind === "message" ? element.event : undefined;
    },
  });
  const transitions: StateMachineTransition<I>[] = [];
  const origins: EdgeOrigin<I>[] = [];
  const firsts: TransitionOf<I>[] = [];
  for (const element of model.elements) {
    const state = isTransparent(element) ? undefined : stateOf<I>(element);
    if (state === undefined) {
      continue;
    }
    states.push(state);
    for (const transition of outgoing.get(element.id) ?? []) {
      firsts.push(transition);
      for (const chain of index.from(transition)) {
        transitions.push(transitionOf(chain));
        origins.push({ first: transition, target: chain.target });
      }
    }
  }
  const carried = index.carried(firsts);

  const loss: Loss<I>[] = [
    ...commonLoss(model, "stateMachine", {
      fragments: new Set(),
      messages: new Set([...carried, ...index.unfolded]),
    }),
    ...unrepresentedLoss(
      model,
      "stateMachine",
      new Set<I["element"]>([
        ...stateIds,
        ...[...folded].filter((id) => !index.unfolded.has(id)),
      ]),
      index.unfolded,
    ),
  ];
  const skipped = model.elements.filter(
    (element) =>
      element.kind === "activity" &&
      isTransparent(element) &&
      !index.unfolded.has(element.id),
  );
  if (skipped.length > 0) {
    loss.push({
      kind: "subject",
      subject,
      elements: skipped.map((element) => element.id),
    });
  }

  return { machine: { subject, states, transitions, loss }, origins, index };
};

/**
 * Activity-as-state projection. Each activity that affects the subject becomes a state the subject entity rests in, and a decision collapses into guarded transitions leaving the state before it. The target activity's action becomes the effect of the transition that enters it.
 *
 * Which activities affect the subject is declared by their `affects`. An activity that does not list the subject is not a state of it: transitions through it are folded into the transition that leaves the previous state, exactly as a decision is. Authored `state` elements and pseudo-states are always kept. When no activity in the model declares `affects`, the model carries no such information and every activity is kept, which is the unscoped behaviour.
 *
 * A `message` element is folded the same way, and its `event`, when it has one, triggers the transition that carries it. A message element no drawn transition carries is reported as a `message-elements` loss.
 *
 * Each drawn transition lists the model `transitions` it stands for and the elements folded into it (`through`), so an edit to it maps back to the model. Several routes through folded elements from the same transition to the same state are one drawn transition whose `transitions` and `through` are the union over the routes, each once in the order met; it carries no event or guard, which differ by route, and its effect is only the target's entry action.
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
): StateMachine<I> => stateMachineParts(model, subject).machine;
