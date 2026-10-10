import type { IdSpace, Model } from "@exadev/process-graph-schema";
import type { ElementOf } from "./actors.ts";
import type { TransitionOf } from "./chains.ts";
import type { ElementChange, ModelDiff, TransitionChange } from "./diff.ts";
import type { EdgeOrigin } from "./flowchart.ts";
import {
  stateMachineParts,
  type StateMachine,
  type StateMachineState,
  type StateMachineTransition,
} from "./state-machine.ts";

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
 * A drawn transition is matched by where it comes from: its first model transition and the state one of its model transitions arrives at. One that stands for a single transition maps straight back: moved ends rewire it, and a changed event, guard or effect changes that transition's trigger, guard or effect. One that stands for a chain through folded elements (decisions, activities that do not affect the subject, messages) shares its later steps with every other chain through the same elements, so the inverse has to choose: moving its source rewires the first step and is certain, but moving its target, changing its labels or removing it acts on each step from a folded element into its target state, once however many drawn transitions share it, and is marked `inferred`. A new transition must carry one new transition id and is added with its event, guard and effect.
 * @param model - The model the machine was projected from.
 * @param edited - The projected machine after editing; `subject` says which projection it was. Its `loss` is not read.
 * @returns The changes, with no event changes, since a state machine names events by id.
 * @throws Error when the edit cannot be expressed in the model: a state that is a model element the machine does not draw, a changed role, a relabelled initial or final state, an unmatched transition that is not a single new transition, or a changed effect where the effect is the target activity's action.
 */
export const diffStateMachine = <I extends IdSpace>(
  model: Model<I>,
  edited: Readonly<Pick<StateMachine<I>, "subject" | "states" | "transitions">>,
): ModelDiff<I> => {
  const parts = stateMachineParts(model, edited.subject);
  const original = parts.machine;
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
  // Drawn transitions are matched by where they come from: the transition they start with and the state they end at, read from the projection's own record for the original ones, so a transition through folded elements is never built just to be compared.
  const keyOf = (first: I["transition"], target: I["element"]): string =>
    JSON.stringify([first, target]);
  const originals = new Map<
    string,
    {
      readonly drawn: StateMachineTransition<I>;
      readonly origin: EdgeOrigin<I>;
    }
  >();
  for (const [position, origin] of parts.origins.entries()) {
    const drawnTransition = original.transitions[position];
    if (drawnTransition !== undefined) {
      originals.set(keyOf(origin.first.id, origin.target), {
        drawn: drawnTransition,
        origin,
      });
    }
  }
  /** An edited transition's key: its first model transition and the state one of its model transitions arrives at, or `undefined` when its first transition is new. */
  const editedKey = (edit: StateMachineTransition<I>): string | undefined => {
    const [first] = edit.transitions;
    if (first === undefined || !transitions.has(first)) {
      return undefined;
    }
    for (const id of edit.transitions) {
      const target = transitions.get(id)?.target;
      if (target !== undefined && drawn.has(target)) {
        return keyOf(first, target);
      }
    }

    return undefined;
  };
  const editedKeys = new Set<string | undefined>(
    edited.transitions.map(editedKey),
  );
  /** The model transitions arriving at a drawn transition's state: its one transition, or every step from a folded element into that state. */
  const arriving = (origin: EdgeOrigin<I>): readonly TransitionOf<I>[] =>
    origin.first.target === origin.target
      ? [origin.first]
      : parts.index.arriving(origin.target);
  const transitionChanges: TransitionChange<I>[] = [];
  // A step from a folded element is shared by every chain through it, so a change to it is made once however many drawn transitions ask for it.
  const made = new Set<string>();
  const push = (change: TransitionChange<I>): void => {
    const key = JSON.stringify(change);
    if (!made.has(key)) {
      made.add(key);
      transitionChanges.push(change);
    }
  };
  // Omitted transitions are grouped by how they end first: one that is a single model transition removes it; ones through folded elements share their steps into a state, so each such state has its arriving steps removed once.
  const endsLeft = new Set<I["element"]>();
  for (const [key, { origin }] of originals) {
    if (editedKeys.has(key)) {
      continue;
    }
    if (origin.first.target === origin.target) {
      push({ kind: "removed", transition: origin.first.id, inferred: false });
    } else {
      endsLeft.add(origin.target);
    }
  }
  for (const end of endsLeft) {
    for (const tail of parts.index.arriving(end)) {
      push({ kind: "removed", transition: tail.id, inferred: true });
    }
  }
  // An edit to a transition through folded elements acts on the steps into its state, which every such transition into that state shares: each kind of edit is made once per state, and edits to the same state that disagree are refused.
  const editedEnds = new Map<string, string>();
  const firstAtEnd = (
    end: I["element"],
    kind: string,
    value: unknown,
  ): boolean => {
    const key = JSON.stringify([end, kind]);
    // `JSON.stringify` gives no text for `undefined`, which here means the label was cleared.
    const wanted = value === undefined ? "" : `=${JSON.stringify(value)}`;
    const already = editedEnds.get(key);
    if (already === undefined) {
      editedEnds.set(key, wanted);

      return true;
    }
    if (already !== wanted) {
      throw new Error(
        `Transitions into "${end}" through the same steps were edited differently (${kind})`,
      );
    }

    return false;
  };
  for (const edit of edited.transitions) {
    const key = editedKey(edit);
    const before = key === undefined ? undefined : originals.get(key);
    const [first, ...rest] = edit.transitions;
    if (before === undefined) {
      if (
        first === undefined ||
        rest.length > 0 ||
        transitions.has(first) ||
        edit.through !== undefined
      ) {
        throw new Error(
          `Transition ${JSON.stringify(edit.transitions)} is neither a transition of the model nor a new transition with a single new id`,
        );
      }
      push({
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
    const { origin, drawn: previous } = before;
    const head = origin.first;
    const chain = head.target !== origin.target;
    const tails = arriving(origin);
    /** The arriving steps to act on for one kind of edit: the transition itself, or the shared steps into the state the first time that kind of edit reaches it. */
    const acting = (
      kind: string,
      value: unknown,
    ): readonly TransitionOf<I>[] =>
      !chain || firstAtEnd(origin.target, kind, value) ? tails : [];
    if (
      !chain &&
      (previous.source !== edit.source || previous.target !== edit.target)
    ) {
      push({
        kind: "rewired",
        transition: head.id,
        from: { source: head.source, target: head.target },
        to: { source: edit.source, target: edit.target },
        inferred: false,
      });
    } else if (chain) {
      if (previous.source !== edit.source) {
        push({
          kind: "rewired",
          transition: head.id,
          from: { source: head.source, target: head.target },
          to: { source: edit.source, target: head.target },
          inferred: false,
        });
      }
      for (const tail of previous.target === edit.target
        ? []
        : acting("target", edit.target)) {
        push({
          kind: "rewired",
          transition: tail.id,
          from: { source: tail.source, target: tail.target },
          to: { source: tail.source, target: edit.target },
          inferred: true,
        });
      }
    }
    for (const tail of previous.event === edit.event
      ? []
      : acting("trigger", edit.event)) {
      push({
        kind: "changed",
        field: "trigger",
        transition: tail.id,
        from: tail.trigger,
        to: edit.event,
        inferred: chain,
      });
    }
    for (const tail of previous.guard === edit.guard
      ? []
      : acting("guard", edit.guard)) {
      push({
        kind: "changed",
        field: "guard",
        transition: tail.id,
        from: tail.guard,
        to: edit.guard,
        inferred: chain,
      });
    }
    if (previous.effect !== edit.effect) {
      const target = elements.get(previous.target);
      if (target?.kind === "activity" && target.action !== undefined) {
        throw new Error(
          `The effect of ${JSON.stringify(edit.transitions)} is the action of "${target.id}"; change that activity's action instead`,
        );
      }
      for (const tail of acting("effect", edit.effect)) {
        push({
          kind: "changed",
          field: "effect",
          transition: tail.id,
          from: tail.effect,
          to: edit.effect,
          inferred: chain,
        });
      }
    }
  }

  return {
    elements: elementChanges,
    transitions: transitionChanges,
    events: [],
  };
};
