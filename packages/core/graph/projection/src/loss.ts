import type {
  IdSpace,
  Model,
  Notation,
  PseudoRole,
} from "@exadev/process-graph-schema";

/** What an element that a notation cannot draw is: an element kind, or the role of a pseudo-state. A `message` element is one only when the notation would fold it but folding it would multiply edges. */
export type UnrepresentedKind =
  "activity" | "decision" | "state" | "message" | PseudoRole;

/** An element a projection could not draw, and what it was. */
export interface UnrepresentedElement<I extends IdSpace> {
  readonly element: I["element"];
  readonly kind: UnrepresentedKind;
}

/**
 * Something a projection does not carry from the model into its result. A projection returns every loss that applies, in this order: layout, extensions, message elements, fragments, then the notation's own choice (unrepresented elements, subject, scenario, unshown branches, skipped steps). A kind is only reported when something was actually dropped.
 */
export type Loss<I extends IdSpace> =
  /** Positions recorded for this projection's notation in `views`. No projection reads or keeps coordinates. */
  | { readonly kind: "layout"; readonly elements: readonly I["element"][] }
  /** Elements carrying notation-only `extensions`, which no projection shows. */
  | { readonly kind: "extensions"; readonly elements: readonly I["element"][] }
  /** `message` elements the projection neither draws nor folds into an edge or transition. */
  | {
      readonly kind: "message-elements";
      readonly elements: readonly I["element"][];
    }
  /** Authored fragments the projection does not draw. */
  | {
      readonly kind: "fragments";
      readonly fragments: readonly I["fragment"][];
    }
  /** Elements, other than messages, that the notation has no way to draw, and the transitions left out because one end of them is such an element. */
  | {
      readonly kind: "unrepresented-elements";
      readonly notation: Notation;
      readonly elements: readonly UnrepresentedElement<I>[];
      readonly transitions: readonly I["transition"][];
    }
  /** Activities left out of a state machine because they do not affect its subject. */
  | {
      readonly kind: "subject";
      readonly subject: I["entity"];
      readonly elements: readonly I["element"][];
    }
  /** Elements of the model that are not on the sequence diagram's scenario. */
  | { readonly kind: "scenario"; readonly elements: readonly I["element"][] }
  /** Transitions leaving an element on the scenario that the scenario does not take. */
  | {
      readonly kind: "unshown-branches";
      readonly transitions: readonly I["transition"][];
    }
  /** Scenario steps that produced no message because an end of the transition has no actor. */
  | {
      readonly kind: "skipped-steps";
      readonly transitions: readonly I["transition"][];
    };

/**
 * The elements the notation cannot draw: every element that is neither in `accounted` (drawn, or folded away by design, as a decision is in a state machine) nor a `message`, which `commonLoss` reports as `message-elements` when it is not shown.
 * @param model - The model being projected.
 * @param notation - The notation that cannot draw them.
 * @param accounted - Elements the projection draws or folds away by design.
 * @returns A single `unrepresented-elements` loss, or none when every element is accounted for.
 */
export const unrepresentedLoss = <I extends IdSpace>(
  model: Model<I>,
  notation: Notation,
  accounted: ReadonlySet<I["element"]>,
  unfolded: ReadonlySet<I["element"]>,
): readonly Loss<I>[] => {
  const elements: UnrepresentedElement<I>[] = [];
  for (const element of model.elements) {
    const message = element.kind === "message" && !unfolded.has(element.id);
    if (message || accounted.has(element.id)) {
      continue;
    }
    elements.push({
      element: element.id,
      kind: element.kind === "pseudo" ? element.role : element.kind,
    });
  }
  if (elements.length === 0) {
    return [];
  }

  const lost = new Set<I["element"]>(elements.map((entry) => entry.element));
  const transitions = model.transitions
    .filter(
      (transition) =>
        lost.has(transition.source) || lost.has(transition.target),
    )
    .map((transition) => transition.id);

  return [{ kind: "unrepresented-elements", notation, elements, transitions }];
};

/** What a projection drew of the elements and fragments that only some notations can show. */
export interface Shown<I extends IdSpace> {
  /** Authored fragments drawn. */
  readonly fragments: ReadonlySet<I["fragment"]>;
  /** `message` elements drawn, or folded into an edge or transition that carries them. */
  readonly messages: ReadonlySet<I["element"]>;
}

/**
 * The losses every projection can have, whatever its notation: dropped layout, notation-only extensions, message elements and authored fragments.
 * @param model - The model projected.
 * @param notation - The notation whose recorded positions are dropped.
 * @param shown - The message elements and fragments the projection did draw, which are therefore not reported.
 */
export const commonLoss = <I extends IdSpace>(
  model: Model<I>,
  notation: Notation,
  shown: Shown<I>,
): readonly Loss<I>[] => {
  const positions = model.views?.[notation];
  const positioned = model.elements.filter(
    (element) => positions?.[element.id] !== undefined,
  );
  const withExtensions = model.elements.filter(
    (element) =>
      element.extensions !== undefined &&
      Object.keys(element.extensions).length > 0,
  );
  const messages = model.elements.filter(
    (element) => element.kind === "message" && !shown.messages.has(element.id),
  );
  const hidden = model.fragments.filter(
    (fragment) => !shown.fragments.has(fragment.id),
  );

  const losses: Loss<I>[] = [];
  if (positioned.length > 0) {
    losses.push({
      kind: "layout",
      elements: positioned.map((element) => element.id),
    });
  }
  if (withExtensions.length > 0) {
    losses.push({
      kind: "extensions",
      elements: withExtensions.map((element) => element.id),
    });
  }
  if (messages.length > 0) {
    losses.push({
      kind: "message-elements",
      elements: messages.map((element) => element.id),
    });
  }
  if (hidden.length > 0) {
    losses.push({
      kind: "fragments",
      fragments: hidden.map((fragment) => fragment.id),
    });
  }

  return losses;
};
