import type {
  Element,
  IdSpace,
  Model,
  Transition,
} from "@exadev/process-graph-schema";

/** Where a transition runs from and to. */
export interface Ends<I extends IdSpace> {
  readonly source: I["element"];
  readonly target: I["element"];
}

/** Who sends and who receives a `message` element. */
export interface Addressing<I extends IdSpace> {
  readonly from: I["actor"];
  readonly to: I["actor"];
}

/**
 * A change to one element that an edited view implies. `inferred` is true when the view did not determine the change and the inverse chose it, for instance a new step a sequence diagram implies; such a change stays unapplied until it is confirmed with `confirmChanges`.
 */
export type ElementChange<I extends IdSpace> =
  | {
      readonly kind: "added";
      readonly element: Element<I["element"], I>;
      readonly inferred: boolean;
    }
  | {
      readonly kind: "removed";
      readonly element: I["element"];
      readonly inferred: boolean;
    }
  | {
      readonly kind: "renamed";
      readonly element: I["element"];
      readonly from: string;
      readonly to: string;
      readonly inferred: boolean;
    }
  /** The element moved to another actor's lane; `undefined` is no actor. */
  | {
      readonly kind: "relaned";
      readonly element: I["element"];
      readonly from: I["actor"] | undefined;
      readonly to: I["actor"] | undefined;
      readonly inferred: boolean;
    }
  /** A `message` element now goes between other actors. */
  | {
      readonly kind: "readdressed";
      readonly element: I["element"];
      readonly from: Addressing<I>;
      readonly to: Addressing<I>;
      readonly inferred: boolean;
    };

/** A change to one of a transition's labels: its human `guard`, its `trigger` event or its `effect` action. */
export type TransitionFieldChange<I extends IdSpace> =
  | {
      readonly field: "guard";
      readonly from: string | undefined;
      readonly to: string | undefined;
    }
  | {
      readonly field: "trigger";
      readonly from: I["event"] | undefined;
      readonly to: I["event"] | undefined;
    }
  | {
      readonly field: "effect";
      readonly from: I["action"] | undefined;
      readonly to: I["action"] | undefined;
    };

/** A change to one transition that an edited view implies. `inferred` has the same meaning as on `ElementChange`. */
export type TransitionChange<I extends IdSpace> =
  | {
      readonly kind: "added";
      readonly transition: Transition<I["transition"], I>;
      readonly inferred: boolean;
    }
  | {
      readonly kind: "removed";
      readonly transition: I["transition"];
      readonly inferred: boolean;
    }
  | {
      readonly kind: "rewired";
      readonly transition: I["transition"];
      readonly from: Ends<I>;
      readonly to: Ends<I>;
      readonly inferred: boolean;
    }
  | (TransitionFieldChange<I> & {
      readonly kind: "changed";
      readonly transition: I["transition"];
      readonly inferred: boolean;
    });

/** A renamed event: a sequence message labelled by its trigger's name was relabelled. */
export interface EventChange<I extends IdSpace> {
  readonly kind: "renamed";
  readonly event: I["event"];
  readonly from: string;
  readonly to: string;
  readonly inferred: boolean;
}

/** What an edited view changes in the model, by identifier. Each list is in the order the changes were found: the model's order for what was there, then the view's order for what is new. */
export interface ModelDiff<I extends IdSpace> {
  readonly elements: readonly ElementChange<I>[];
  readonly transitions: readonly TransitionChange<I>[];
  readonly events: readonly EventChange<I>[];
}

/** Any one change in a `ModelDiff`. */
export type Change<I extends IdSpace> =
  ElementChange<I> | TransitionChange<I> | EventChange<I>;

/** Thrown by `applyModelDiff` when the diff still holds changes the inverse inferred and nobody confirmed. */
export class UnconfirmedChangeError<I extends IdSpace> extends Error {
  /** The changes still marked `inferred`. */
  readonly changes: readonly Change<I>[];

  constructor(changes: readonly Change<I>[]) {
    super(
      `The diff holds inferred changes that have not been confirmed: ${changes
        .map((change) => change.kind)
        .join(", ")}`,
    );
    this.name = "UnconfirmedChangeError";
    this.changes = changes;
  }
}

/**
 * Marks inferred changes as confirmed, so `applyModelDiff` will apply them.
 * @param diff - A diff returned by one of the view inverses.
 * @param accept - Chooses which inferred changes to confirm; the rest stay inferred.
 * @returns A new diff; `diff` is not modified.
 */
export const confirmChanges = <I extends IdSpace>(
  diff: ModelDiff<I>,
  accept: (change: Change<I>) => boolean,
): ModelDiff<I> => ({
  elements: diff.elements.map((change) =>
    change.inferred && accept(change) ? { ...change, inferred: false } : change,
  ),
  transitions: diff.transitions.map((change) =>
    change.inferred && accept(change) ? { ...change, inferred: false } : change,
  ),
  events: diff.events.map((change) =>
    change.inferred && accept(change) ? { ...change, inferred: false } : change,
  ),
});

type ElementOf<I extends IdSpace> = Element<I["element"], I>;
type TransitionOf<I extends IdSpace> = Transition<I["transition"], I>;

/** A copy of `value` without `key`, for clearing an optional field, which `exactOptionalPropertyTypes` will not let be set to `undefined`. */
const without = <T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> => {
  const copy = { ...value };
  Reflect.deleteProperty(copy, key);

  return copy;
};

/** Applies one change to the element it names; additions and removals are applied to the element list instead. */
const applyElementChange = <I extends IdSpace>(
  element: ElementOf<I>,
  change: ElementChange<I>,
): ElementOf<I> => {
  if (change.kind === "renamed") {
    if (element.kind === "pseudo") {
      throw new Error(
        `Element "${element.id}" is a pseudo-state and has no label to rename`,
      );
    }

    return { ...element, label: change.to };
  }
  if (change.kind === "relaned") {
    if (element.kind !== "activity" && element.kind !== "decision") {
      throw new Error(
        `Element "${element.id}" is a ${element.kind} and has no actor to move`,
      );
    }

    return change.to === undefined
      ? without(element, "actor")
      : { ...element, actor: change.to };
  }
  if (change.kind === "readdressed") {
    if (element.kind !== "message") {
      throw new Error(
        `Element "${element.id}" is a ${element.kind}, not a message`,
      );
    }

    return { ...element, from: change.to.from, to: change.to.to };
  }

  return element;
};

/** Applies one change to the transition it names; additions and removals are applied to the transition list instead. */
const applyTransitionChange = <I extends IdSpace>(
  transition: TransitionOf<I>,
  change: TransitionChange<I>,
): TransitionOf<I> => {
  if (change.kind === "rewired") {
    return { ...transition, ...change.to };
  }
  if (change.kind !== "changed") {
    return transition;
  }
  if (change.field === "guard") {
    return change.to === undefined
      ? without(transition, "guard")
      : { ...transition, guard: change.to };
  }
  if (change.field === "trigger") {
    return change.to === undefined
      ? without(transition, "trigger")
      : { ...transition, trigger: change.to };
  }

  return change.to === undefined
    ? without(transition, "effect")
    : { ...transition, effect: change.to };
};

/** The items of `items` grouped by the key `keyOf` gives each, every group in the order of `items`; one pass, so looking a group up afterwards costs nothing per item. */
const groupBy = <Key, Item>(
  items: readonly Item[],
  keyOf: (item: Item) => Key,
): ReadonlyMap<Key, readonly Item[]> => {
  const groups = new Map<Key, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }

  return groups;
};

/** The identifier a change is about, used to find what it applies to. */
const subjectOf = <I extends IdSpace>(
  change: ElementChange<I>,
): I["element"] =>
  change.kind === "added" ? change.element.id : change.element;

const transitionSubjectOf = <I extends IdSpace>(
  change: TransitionChange<I>,
): I["transition"] =>
  change.kind === "added" ? change.transition.id : change.transition;

/**
 * Applies a confirmed diff to the model, returning a new model.
 *
 * Removing an element also takes it out of fragment bodies and recorded positions; removing a transition also takes it out of every sequence scenario. Transitions that touched a removed element are only removed when the diff says so, as every view inverse does, so a diff built by hand that leaves one dangling yields a model `validate` reports.
 * @param model - The model the diff was computed against.
 * @param diff - The changes, with every inferred one confirmed.
 * @returns The changed model; `model` is not modified.
 * @throws UnconfirmedChangeError when a change is still marked `inferred`.
 * @throws Error when a change names an element, transition or event the model does not have, or asks for something the element's kind cannot carry, such as a label on a pseudo-state.
 */
export const applyModelDiff = <I extends IdSpace>(
  model: Model<I>,
  diff: ModelDiff<I>,
): Model<I> => {
  const unconfirmed = [
    ...diff.elements,
    ...diff.transitions,
    ...diff.events,
  ].filter((change) => change.inferred);
  if (unconfirmed.length > 0) {
    throw new UnconfirmedChangeError(unconfirmed);
  }

  const elementIds = new Set<I["element"]>(
    model.elements.map((element) => element.id),
  );
  for (const change of diff.elements) {
    if (change.kind !== "added" && !elementIds.has(subjectOf(change))) {
      throw new Error(`Element "${subjectOf(change)}" is not in the model`);
    }
  }
  const transitionIds = new Set<I["transition"]>(
    model.transitions.map((transition) => transition.id),
  );
  for (const change of diff.transitions) {
    const id = transitionSubjectOf(change);
    if (change.kind !== "added" && !transitionIds.has(id)) {
      throw new Error(`Transition "${id}" is not in the model`);
    }
  }
  const eventIds = new Set<I["event"]>(model.events.map((event) => event.id));
  for (const change of diff.events) {
    if (!eventIds.has(change.event)) {
      throw new Error(`Event "${change.event}" is not in the model`);
    }
  }

  const removedElements = new Set<I["element"]>(
    diff.elements.flatMap((change) =>
      change.kind === "removed" ? [change.element] : [],
    ),
  );
  const removedTransitions = new Set<I["transition"]>(
    diff.transitions.flatMap((change) =>
      change.kind === "removed" ? [change.transition] : [],
    ),
  );

  // Each change list is grouped by the identifier it is about once, so every element, transition and event reads only its own changes.
  const elementChanges = groupBy(diff.elements, subjectOf);
  const transitionChanges = groupBy(diff.transitions, transitionSubjectOf);
  const eventChanges = groupBy(diff.events, (change) => change.event);

  const elements = [
    ...model.elements
      .filter((element) => !removedElements.has(element.id))
      .map((element) =>
        (elementChanges.get(element.id) ?? []).reduce(
          applyElementChange,
          element,
        ),
      ),
    ...diff.elements.flatMap((change) =>
      change.kind === "added" ? [change.element] : [],
    ),
  ];
  const transitions = [
    ...model.transitions
      .filter((transition) => !removedTransitions.has(transition.id))
      .map((transition) =>
        (transitionChanges.get(transition.id) ?? []).reduce(
          applyTransitionChange,
          transition,
        ),
      ),
    ...diff.transitions.flatMap((change) =>
      change.kind === "added" ? [change.transition] : [],
    ),
  ];
  const events = model.events.map((event) =>
    (eventChanges.get(event.id) ?? []).reduce(
      (renamed, change) => ({ ...renamed, name: change.to }),
      event,
    ),
  );
  const fragments = model.fragments.map((fragment) => ({
    ...fragment,
    operands: fragment.operands.map((operand) => ({
      ...operand,
      body: operand.body.filter((id) => !removedElements.has(id)),
    })),
  }));
  const projections = model.projections.map((projection) =>
    projection.notation === "sequence"
      ? {
          ...projection,
          scenario: projection.scenario.filter(
            (id) => !removedTransitions.has(id),
          ),
        }
      : projection,
  );
  const views =
    model.views === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(model.views).map(([notation, positions]) => [
            notation,
            Object.fromEntries(
              Object.entries(positions).filter(
                ([id]) => !removedElements.has(id),
              ),
            ),
          ]),
        );

  return {
    ...model,
    elements,
    transitions,
    events,
    fragments,
    projections,
    ...(views === undefined ? {} : { views }),
  };
};
