import {
  CycleError,
  findCycles,
  topologicalLayers,
  type Dag,
} from "@exadev/process-graph-dag";
import type { IdSpace, Model, Overlay } from "@exadev/process-graph-schema";
import { controlDag, loopTransitions } from "./control.ts";
import { evaluateBranches, isProvided, type Facts } from "./facts.ts";
import { lookup } from "./lookup.ts";
import type { Branch, Status } from "./status.ts";

/** Everything one derivation reads. */
export interface Run<I extends IdSpace> {
  readonly model: Model<I>;
  readonly overlay: Overlay<I>;
  readonly facts: Facts;
}

/** The result of deriving a run: shared by every query so each computes the same state. */
export interface Analysis<I extends IdSpace> {
  /** The control graph with loop edges removed. */
  readonly dag: Dag<I["element"]>;
  readonly branches: ReadonlyMap<I["transition"], Branch>;
  readonly statuses: ReadonlyMap<I["element"], Status>;
  /**
   * For each element, the elements its progress still depends on: the sources of its incoming transitions that are not cut (the condition is not definitely false and the source is not skipped) and the producers of the artefacts it consumes that are neither provided nor produced already, except producers that are skipped. Includes elements that are done.
   */
  readonly liveNeeds: ReadonlyMap<I["element"], readonly I["element"][]>;
}

/**
 * Derives the status of every element and the structures the queries share.
 *
 * Elements are visited in dependency order of the control graph. For each element, with its incoming non-loop transitions:
 *
 * 1. A transition is cut when its condition is definitely false or its source is `skipped`. The others are live.
 * 2. `done` when the overlay says `done`.
 * 3. `unknown` when the overlay says `unknown`, a live transition's condition is indeterminate or its source is `unknown`, or a consumed artefact that is not provided and has no done producer has an `unknown` producer.
 * 4. `skipped` when it has incoming transitions and every one is cut.
 * 5. `ready` when every live transition's source is `done` and each consumed artefact is provided or has a done producer; `blocked` otherwise. This single rule is also the join rule: a join, like any element, waits for every incoming source that is not skipped.
 * 6. A `decision` or `pseudo` element has no work of its own: when the rule above gives it `ready`, it is `done`, so downstream elements are not held up by a step nobody can perform. An overlay `unknown` still applies to it.
 *
 * An element with no overlay entry is open. `unknown` dominates `blocked`: an element that has an unknown need is `unknown` even if another need is open.
 */
export const analyse = <I extends IdSpace>({
  model,
  overlay,
  facts,
}: Readonly<Run<I>>): Analysis<I> => {
  const loops = new Set(loopTransitions(model));
  const dag = controlDag(model);
  const cycles = findCycles(dag);
  if (cycles.length > 0) {
    throw new CycleError(cycles);
  }

  const branches = evaluateBranches(model, overlay, facts);
  const elements = new Map(
    model.elements.map((element) => [element.id, element]),
  );
  const incoming = new Map<I["element"], I["transition"][]>(
    model.elements.map(({ id }) => [id, []]),
  );
  for (const transition of model.transitions) {
    if (!loops.has(transition.id)) {
      lookup(incoming, transition.target).push(transition.id);
    }
  }
  const transitions = new Map(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  const producers = new Map<I["artefact"], I["element"][]>();
  for (const element of model.elements) {
    if (element.kind === "activity") {
      for (const artefact of element.produces ?? []) {
        producers.set(artefact, [
          ...(producers.get(artefact) ?? []),
          element.id,
        ]);
      }
    }
  }

  const statuses = new Map<I["element"], Status>();
  const liveNeeds = new Map<I["element"], readonly I["element"][]>();
  for (const id of topologicalLayers(dag).layers.flat()) {
    const element = lookup(elements, id);
    const edges = lookup(incoming, id).map((transitionId) => ({
      source: lookup(transitions, transitionId).source,
      branch: lookup(branches, transitionId),
    }));
    const live = edges.filter(
      ({ source, branch }) =>
        branch !== "not-taken" && lookup(statuses, source) !== "skipped",
    );

    const dataNeeds = new Set<I["element"]>();
    let dataUnknown = false;
    let dataUnmet = false;
    for (const artefact of element.kind === "activity"
      ? (element.consumes ?? [])
      : []) {
      const makers = producers.get(artefact) ?? [];
      const made = makers.map((maker) => lookup(statuses, maker));
      if (isProvided(facts, artefact) || made.includes("done")) {
        continue;
      }
      dataUnmet = true;
      dataUnknown ||= made.includes("unknown");
      for (const maker of makers) {
        if (lookup(statuses, maker) !== "skipped") {
          dataNeeds.add(maker);
        }
      }
    }
    liveNeeds.set(id, [
      ...new Set([...live.map(({ source }) => source), ...dataNeeds]),
    ]);

    const own = overlay[id];
    let status: Status;
    if (own === "done") {
      status = "done";
    } else if (
      own === "unknown" ||
      dataUnknown ||
      live.some(
        ({ source, branch }) =>
          branch === "indeterminate" || lookup(statuses, source) === "unknown",
      )
    ) {
      status = "unknown";
    } else if (edges.length > 0 && live.length === 0) {
      status = "skipped";
    } else if (
      !dataUnmet &&
      live.every(({ source }) => lookup(statuses, source) === "done")
    ) {
      status =
        element.kind === "decision" || element.kind === "pseudo"
          ? "done"
          : "ready";
    } else {
      status = "blocked";
    }
    statuses.set(id, status);
  }

  return {
    dag,
    branches,
    statuses: new Map(dag.nodes.map((id) => [id, lookup(statuses, id)])),
    liveNeeds,
  };
};

/**
 * The derived status of every element. See `analyse` for the rules; the semantics are documented in the package README.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided (see `artefactKey`).
 * @returns A status for every element, in model order.
 * @throws CycleError when the control graph contains an illegal cycle (see `illegalCycles`), since status is undefined on it.
 * @throws UnknownNodeError when a transition refers to an element the model does not declare.
 * @throws UnsupportedConditionError when a condition needs a table or collection from the facts port.
 */
export const deriveStatuses = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
): ReadonlyMap<I["element"], Status> =>
  analyse({ model, overlay, facts }).statuses;
