import type { IdSpace, Model, Notation } from "@exadev/process-graph-schema";

/**
 * Something a projection does not carry from the model into its result. A projection returns every loss that applies, in this order: layout, extensions, message elements, fragments, then the notation's own choice (subject, scenario, unshown branches). A kind is only reported when something was actually dropped.
 */
export type Loss<I extends IdSpace> =
  /** Positions recorded for this projection's notation in `views`. No projection reads or keeps coordinates. */
  | { readonly kind: "layout"; readonly elements: readonly I["element"][] }
  /** Elements carrying notation-only `extensions`, which no projection shows. */
  | { readonly kind: "extensions"; readonly elements: readonly I["element"][] }
  /** `message` elements, which the projection does not draw. */
  | {
      readonly kind: "message-elements";
      readonly elements: readonly I["element"][];
    }
  /** Authored fragments the projection does not draw. */
  | {
      readonly kind: "fragments";
      readonly fragments: readonly I["fragment"][];
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
    };

/** The losses every projection can have, whatever its notation: dropped layout, notation-only extensions, message elements and authored fragments. */
export const commonLoss = <I extends IdSpace>(
  model: Model<I>,
  notation: Notation,
  shownFragments: ReadonlySet<I["fragment"]> = new Set(),
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
    (element) => element.kind === "message",
  );
  const hidden = model.fragments.filter(
    (fragment) => !shownFragments.has(fragment.id),
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
