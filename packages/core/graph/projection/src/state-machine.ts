import type { IdSpace, Model, Transition } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";

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
}

export interface StateMachine<I extends IdSpace> {
  readonly subject: I["entity"];
  readonly states: readonly StateMachineState<I>[];
  readonly transitions: readonly StateMachineTransition<I>[];
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
 * Activity-as-state projection. Each activity becomes a state the subject entity rests in, and a decision collapses into guarded transitions leaving the state before it. The target activity's action becomes the effect of the transition that enters it.
 *
 * Other conventions exist, such as steps as transitions with states between them. Naming states such as "Paid" needs authored states, which the model can hold as `state` elements.
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

  interface Arrival {
    readonly target: I["element"];
    readonly event: I["event"] | undefined;
    readonly guard: string | undefined;
    readonly effect: I["action"] | undefined;
  }

  const elements = new Map<I["element"], ElementOf<I>>(
    model.elements.map((element) => [element.id, element]),
  );
  const outgoing = new Map<I["element"], Transition<I["transition"], I>[]>();
  for (const transition of model.transitions) {
    const list = outgoing.get(transition.source);
    if (list === undefined) {
      outgoing.set(transition.source, [transition]);
    } else {
      list.push(transition);
    }
  }

  const joinGuards = (
    first: string | undefined,
    second: string | undefined,
  ): string | undefined => {
    if (first === undefined) {
      return second;
    }

    return second === undefined ? first : `${first} and ${second}`;
  };

  const resolve = (
    transition: Transition<I["transition"], I>,
    seen: ReadonlySet<I["element"]>,
  ): readonly Arrival[] => {
    const target = elements.get(transition.target);
    if (target?.kind === "decision" && !seen.has(target.id)) {
      const visited = new Set(seen).add(target.id);
      const arrivals: Arrival[] = [];
      for (const onward of outgoing.get(target.id) ?? []) {
        for (const arrival of resolve(onward, visited)) {
          arrivals.push({
            target: arrival.target,
            event: arrival.event ?? transition.trigger,
            guard: joinGuards(transition.guard, arrival.guard),
            effect: arrival.effect ?? transition.effect,
          });
        }
      }

      return arrivals;
    }
    const entryAction = target?.kind === "activity" ? target.action : undefined;

    return [
      {
        target: transition.target,
        event: transition.trigger,
        guard: transition.guard,
        effect: entryAction ?? transition.effect,
      },
    ];
  };

  const states: StateMachineState<I>[] = [];
  const transitions: StateMachineTransition<I>[] = [];
  for (const element of model.elements) {
    const state = stateOf<I>(element);
    if (state === undefined) {
      continue;
    }
    states.push(state);
    for (const transition of outgoing.get(element.id) ?? []) {
      for (const arrival of resolve(transition, new Set<I["element"]>())) {
        transitions.push({
          source: element.id,
          target: arrival.target,
          ...(arrival.event === undefined ? {} : { event: arrival.event }),
          ...(arrival.guard === undefined ? {} : { guard: arrival.guard }),
          ...(arrival.effect === undefined ? {} : { effect: arrival.effect }),
        });
      }
    }
  }

  return { subject, states, transitions };
};
