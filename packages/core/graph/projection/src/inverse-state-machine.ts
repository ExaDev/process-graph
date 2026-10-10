import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import type { ElementChange, ModelDiff, TransitionChange } from "./diff.ts";
import {
  toStateMachine,
  type StateMachine,
  type StateMachineState,
  type StateMachineTransition,
} from "./state-machine.ts";

/** The key a transition is matched by across the original and the edited machine: the model transitions it stands for. */
const transitionKey = <I extends IdSpace>(
  transition: StateMachineTransition<I>,
): string => JSON.stringify(transition.transitions);

/** The element an added state becomes: an authored `state`, or an initial or final pseudo-state. */
const addedState = <I extends IdSpace>(
  state: StateMachineState<I>,
): ElementChange<I> => ({
  kind: "added",
  element:
    state.role === "state"
      ? { kind: "state", id: state.id, label: state.label }
      : { kind: "pseudo", id: state.id, role: state.role },
  inferred: false,
});

/**
 * The inverse of `toStateMachine`: what an edited state machine changes in the model, matched by element and transition id.
 *
 * A state not in the projection is an added element: a `state` element for a plain state, or an initial or final pseudo-state. A projected state missing from the edit is removed, and a changed label renames the activity or state behind it.
 *
 * A drawn transition is matched by the model transitions it stands for. One that stands for a single transition maps straight back: moved ends rewire it, and a changed event, guard or effect changes that transition's trigger, guard or effect. One that stands for a chain through folded elements (decisions, activities that do not affect the subject, messages) shares its later steps with every other chain through the same elements, so the inverse has to choose: moving its source rewires the first step and is certain, but moving its target, changing its labels or removing it acts on the last step and is marked `inferred`. A new transition must carry one new transition id and is added with its event, guard and effect.
 * @param model - The model the machine was projected from.
 * @param edited - The projected machine after editing; `subject` says which projection it was. Its `loss` is not read.
 * @returns The changes, with no event changes, since a state machine names events by id.
 * @throws Error when the edit cannot be expressed in the model: a state that is a model element the machine does not draw, a changed role, a relabelled initial or final state, an unmatched transition that is not a single new transition, or a changed effect where the effect is the target activity's action.
 */
export const diffStateMachine = <I extends IdSpace>(
  model: Model<I>,
  edited: Readonly<Pick<StateMachine<I>, "subject" | "states" | "transitions">>,
): ModelDiff<I> => {
  const original = toStateMachine(model, edited.subject);
  const elements = new Map<I["element"], ElementOf<I>>(
    model.elements.map((element) => [element.id, element]),
  );
  const drawn = new Map<I["element"], StateMachineState<I>>(
    original.states.map((state) => [state.id, state]),
  );
  const kept = new Set<I["element"]>(edited.states.map((state) => state.id));

  const elementChanges: ElementChange<I>[] = [];
  for (const state of original.states) {
    if (!kept.has(state.id)) {
      elementChanges.push({
        kind: "removed",
        element: state.id,
        inferred: false,
      });
    }
  }
  for (const state of edited.states) {
    const before = drawn.get(state.id);
    if (before === undefined) {
      if (elements.has(state.id)) {
        throw new Error(
          `State "${state.id}" is a model element the state machine does not draw`,
        );
      }
      elementChanges.push(addedState(state));
      continue;
    }
    if (before.role !== state.role) {
      throw new Error(
        `State "${state.id}" changed role from ${before.role} to ${state.role}; remove it and add one under a new id`,
      );
    }
    if (before.label !== state.label) {
      if (state.role !== "state") {
        throw new Error(
          `State "${state.id}" is ${state.role === "initial" ? "an" : "a"} ${state.role} pseudo-state, whose label the projection supplies`,
        );
      }
      elementChanges.push({
        kind: "renamed",
        element: state.id,
        from: before.label,
        to: state.label,
        inferred: false,
      });
    }
  }

  const transitions = new Map(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  const originals = new Map<string, StateMachineTransition<I>>(
    original.transitions.map((transition) => [
      transitionKey(transition),
      transition,
    ]),
  );
  const editedKeys = new Set<string>(edited.transitions.map(transitionKey));
  const transitionChanges: TransitionChange<I>[] = [];
  for (const drawnTransition of original.transitions) {
    const last = drawnTransition.transitions.at(-1);
    if (last !== undefined && !editedKeys.has(transitionKey(drawnTransition))) {
      transitionChanges.push({
        kind: "removed",
        transition: last,
        inferred: drawnTransition.transitions.length > 1,
      });
    }
  }
  for (const edit of edited.transitions) {
    const before = originals.get(transitionKey(edit));
    const [first, ...rest] = edit.transitions;
    if (before === undefined) {
      if (
        first === undefined ||
        rest.length > 0 ||
        transitions.has(first) ||
        edit.through !== undefined
      ) {
        throw new Error(
          `Transition ${transitionKey(edit)} is neither a transition of the model nor a new transition with a single new id`,
        );
      }
      transitionChanges.push({
        kind: "added",
        transition: {
          id: first,
          source: edit.source,
          target: edit.target,
          ...(edit.event === undefined ? {} : { trigger: edit.event }),
          ...(edit.guard === undefined ? {} : { guard: edit.guard }),
          ...(edit.effect === undefined ? {} : { effect: edit.effect }),
        },
        inferred: false,
      });
      continue;
    }
    const head = first === undefined ? undefined : transitions.get(first);
    const lastId = edit.transitions.at(-1);
    const tail = lastId === undefined ? undefined : transitions.get(lastId);
    if (head === undefined || tail === undefined) {
      continue;
    }
    const chain = edit.transitions.length > 1;
    if (
      !chain &&
      (before.source !== edit.source || before.target !== edit.target)
    ) {
      transitionChanges.push({
        kind: "rewired",
        transition: head.id,
        from: { source: head.source, target: head.target },
        to: { source: edit.source, target: edit.target },
        inferred: false,
      });
    } else {
      if (before.source !== edit.source) {
        transitionChanges.push({
          kind: "rewired",
          transition: head.id,
          from: { source: head.source, target: head.target },
          to: { source: edit.source, target: head.target },
          inferred: false,
        });
      }
      if (before.target !== edit.target) {
        transitionChanges.push({
          kind: "rewired",
          transition: tail.id,
          from: { source: tail.source, target: tail.target },
          to: { source: tail.source, target: edit.target },
          inferred: true,
        });
      }
    }
    if (before.event !== edit.event) {
      transitionChanges.push({
        kind: "changed",
        field: "trigger",
        transition: tail.id,
        from: tail.trigger,
        to: edit.event,
        inferred: chain,
      });
    }
    if (before.guard !== edit.guard) {
      transitionChanges.push({
        kind: "changed",
        field: "guard",
        transition: tail.id,
        from: tail.guard,
        to: edit.guard,
        inferred: chain,
      });
    }
    if (before.effect !== edit.effect) {
      const target = elements.get(before.target);
      if (target?.kind === "activity" && target.action !== undefined) {
        throw new Error(
          `The effect of ${transitionKey(edit)} is the action of "${target.id}"; change that activity's action instead`,
        );
      }
      transitionChanges.push({
        kind: "changed",
        field: "effect",
        transition: tail.id,
        from: tail.effect,
        to: edit.effect,
        inferred: chain,
      });
    }
  }

  return {
    elements: elementChanges,
    transitions: transitionChanges,
    events: [],
  };
};
