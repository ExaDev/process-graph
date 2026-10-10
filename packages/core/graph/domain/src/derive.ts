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
  /** For each element, what its status was derived from, recorded by the derivation itself so an explanation never re-derives it. */
  readonly basis: ReadonlyMap<I["element"], StatusBasis<I>>;
}

/** Which of the derivation's rules decided an element's status, in the order the rules are applied. */
export const statusRules = [
  "overlay-done",
  "overlay-unknown",
  "unknown-need",
  "all-cut",
  "needs-met",
  "waiting",
] as const;

/**
 * Which rule decided a status.
 *
 * - `overlay-done`: the overlay says `done`.
 * - `overlay-unknown`: the overlay says `unknown`.
 * - `unknown-need`: a live transition's condition is indeterminate or its source is `unknown`, or a consumed artefact that is not provided and has no done producer has an `unknown` producer.
 * - `all-cut`: the element has incoming transitions and every one is cut, so it is `skipped`.
 * - `needs-met`: every live need is done and every consumed artefact is satisfied, so it is `ready`, or `done` for a decision or pseudo-state.
 * - `waiting`: anything else, so it is `blocked`.
 */
export type StatusRule = (typeof statusRules)[number];

/** An incoming transition of an element, as the derivation saw it. Loop edges are not incoming transitions. */
export interface IncomingBasis<I extends IdSpace> {
  readonly transition: I["transition"];
  readonly source: I["element"];
  /** What the transition's condition evaluated to. */
  readonly branch: Branch;
  /** The derived status of the source. */
  readonly sourceStatus: Status;
  /** Whether the transition is cut: its condition is definitely false or its source is skipped. A cut transition is not a need. */
  readonly cut: boolean;
}

/** A producer of a consumed artefact and its derived status. */
export interface ProducerBasis<I extends IdSpace> {
  readonly element: I["element"];
  readonly status: Status;
}

/** A consumed artefact of an activity, as the derivation saw it. */
export interface ArtefactBasis<I extends IdSpace> {
  readonly artefact: I["artefact"];
  /** Whether the facts port reports it provided from outside the process. */
  readonly provided: boolean;
  /** The activities that produce it, in model order. Empty when none does. */
  readonly producers: readonly ProducerBasis<I>[];
  /** Whether it is provided or a producer is done. */
  readonly satisfied: boolean;
}

/** What one element's status was derived from. */
export interface StatusBasis<I extends IdSpace> {
  readonly rule: StatusRule;
  /** The element's incoming transitions other than loop edges, in model order. */
  readonly transitions: readonly IncomingBasis<I>[];
  /** The artefacts the element consumes, in the order it lists them; empty for anything but an activity. */
  readonly artefacts: readonly ArtefactBasis<I>[];
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
  const basis = new Map<I["element"], StatusBasis<I>>();
  for (const id of topologicalLayers(dag).layers.flat()) {
    const element = lookup(elements, id);
    const edges = lookup(incoming, id).map((transitionId) => {
      const source = lookup(transitions, transitionId).source;
      const branch = lookup(branches, transitionId);
      const sourceStatus = lookup(statuses, source);

      return {
        transition: transitionId,
        source,
        branch,
        sourceStatus,
        cut: branch === "not-taken" || sourceStatus === "skipped",
      };
    });
    const live = edges.filter(({ cut }) => !cut);

    const dataNeeds = new Set<I["element"]>();
    const artefacts: ArtefactBasis<I>[] = [];
    let dataUnknown = false;
    let dataUnmet = false;
    for (const artefact of element.kind === "activity"
      ? (element.consumes ?? [])
      : []) {
      const makers = producers.get(artefact) ?? [];
      const made = makers.map((maker) => lookup(statuses, maker));
      const provided = isProvided(facts, artefact);
      const satisfied = provided || made.includes("done");
      artefacts.push({
        artefact,
        provided,
        producers: makers.map((maker) => ({
          element: maker,
          status: lookup(statuses, maker),
        })),
        satisfied,
      });
      if (satisfied) {
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
    let rule: StatusRule;
    if (own === "done") {
      status = "done";
      rule = "overlay-done";
    } else if (own === "unknown") {
      status = "unknown";
      rule = "overlay-unknown";
    } else if (
      dataUnknown ||
      live.some(
        ({ branch, sourceStatus }) =>
          branch === "indeterminate" || sourceStatus === "unknown",
      )
    ) {
      status = "unknown";
      rule = "unknown-need";
    } else if (edges.length > 0 && live.length === 0) {
      status = "skipped";
      rule = "all-cut";
    } else if (
      !dataUnmet &&
      live.every(({ sourceStatus }) => sourceStatus === "done")
    ) {
      status =
        element.kind === "decision" || element.kind === "pseudo"
          ? "done"
          : "ready";
      rule = "needs-met";
    } else {
      status = "blocked";
      rule = "waiting";
    }
    statuses.set(id, status);
    basis.set(id, { rule, transitions: edges, artefacts });
  }

  return {
    dag,
    branches,
    statuses: new Map(dag.nodes.map((id) => [id, lookup(statuses, id)])),
    liveNeeds,
    basis,
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
