import {
  buildDag,
  descendantsOf,
  findCycles,
  type Dag,
} from "@exadev/process-graph-dag";
import type { IdSpace, Model } from "@exadev/process-graph-schema";

/**
 * Builds the dependency graph over every element, leaving out the transitions in `excluded`. A node needs the source of each remaining incoming transition and, for an activity, the producer of each artefact it consumes.
 */
const buildControl = <I extends IdSpace>(
  model: Model<I>,
  excluded: ReadonlySet<I["transition"]>,
): Dag<I["element"]> => {
  const sources = new Map<I["element"], I["element"][]>(
    model.elements.map(({ id }) => [id, []]),
  );
  for (const transition of model.transitions) {
    const incoming = sources.get(transition.target);
    if (incoming !== undefined && !excluded.has(transition.id)) {
      incoming.push(transition.source);
    }
  }

  const producers = new Map<I["artefact"], I["element"][]>();
  for (const element of model.elements) {
    if (element.kind !== "activity") {
      continue;
    }
    for (const artefact of element.produces ?? []) {
      const known = producers.get(artefact);
      if (known === undefined) {
        producers.set(artefact, [element.id]);
      } else {
        known.push(element.id);
      }
    }
  }

  const consumed = new Map<I["element"], readonly I["artefact"][]>(
    model.elements.flatMap((element) =>
      element.kind === "activity" && element.consumes !== undefined
        ? [[element.id, element.consumes] as const]
        : [],
    ),
  );

  return buildDag(
    model.elements.map(({ id }) => id),
    (id) => [
      ...(sources.get(id) ?? []),
      ...(consumed.get(id) ?? []).flatMap(
        (artefact) => producers.get(artefact) ?? [],
      ),
    ],
  );
};

/**
 * The transitions that re-enter earlier work: a transition leaving a `decision` element whose target can reach its source (or is its source), so that it closes a cycle through the decision.
 *
 * Reachability is over the whole graph, transitions and artefact dependencies alike. Only a decision's own outgoing transitions are candidates: a cycle that contains no decision has no loop edge and is illegal.
 * @param model - The model to read.
 * @returns The loop transitions, in transition order.
 * @throws UnknownNodeError when such a transition's target is not an element of the model.
 */
export const loopTransitions = <I extends IdSpace>(
  model: Model<I>,
): readonly I["transition"][] => {
  const decisions = new Set<I["element"]>(
    model.elements.flatMap((element) =>
      element.kind === "decision" ? [element.id] : [],
    ),
  );
  const whole = buildControl(model, new Set());

  return model.transitions
    .filter(
      (transition) =>
        decisions.has(transition.source) &&
        (transition.target === transition.source ||
          descendantsOf(whole, transition.target).includes(transition.source)),
    )
    .map(({ id }) => id);
};

/**
 * The control graph the whole analysis is computed on, with the loop edges removed.
 *
 * Its nodes are the element ids. A node needs the source of every incoming transition that is not a loop edge (see `loopTransitions`) and, for an activity, the producer of every artefact in `consumes`. Excluding loop edges makes a legal retry or review loop acyclic here, so readiness, layers and the critical path are well defined: a loop edge is a way back to earlier work, never a prerequisite of it. A node whose only incoming transitions are loop edges therefore has no needs.
 *
 * The graph is not guaranteed acyclic: cycles that no decision closes remain and are reported by `illegalCycles`. A transition whose source is not an element appears in `unknownReferences`.
 * @param model - The model to read.
 * @returns The graph over element ids, as a `graph-dag` `Dag`.
 * @throws UnknownNodeError when a decision's transition targets something that is not an element.
 */
export const controlDag = <I extends IdSpace>(
  model: Model<I>,
): Dag<I["element"]> => buildControl(model, new Set(loopTransitions(model)));

/**
 * The cycles of the control graph: every cycle that is not a legal decision loop.
 *
 * A cycle that passes through a `decision` element is a legal loop and is not reported; the loop edge that closes it is left out of `controlDag`. Any cycle that remains has no decision in it, so it can never make progress, and is reported with its path.
 *
 * A path follows `graph-dag`'s convention: each element needs the next one and the last needs the first, which is repeated at the end. `["a", "b", "a"]` means a needs b and b needs a. One path is reported per strongly connected component; break it and call again for the rest.
 * @param model - The model to read.
 * @returns The illegal cycles, empty exactly when every cycle is a legal decision loop.
 * @throws UnknownNodeError when a decision's transition targets something that is not an element.
 */
export const illegalCycles = <I extends IdSpace>(
  model: Model<I>,
): readonly (readonly I["element"][])[] => findCycles(controlDag(model));
