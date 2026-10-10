import {
  buildDag,
  criticalPath as longestPath,
  type CriticalPath,
} from "@exadev/process-graph-dag";
import type { IdSpace, Model, Overlay } from "@exadev/process-graph-schema";
import { analyse, type Analysis } from "./derive.ts";
import { isProvided, type Facts } from "./facts.ts";
import { lookup } from "./lookup.ts";
import type { Status } from "./status.ts";

/** Whether an element still has work ahead of it: it is neither finished nor going to be skipped. */
const isLive = (status: Status): boolean =>
  status !== "done" && status !== "skipped";

/** The live needs of an element that are not done: what it is still waiting for. */
const waitingOn = <I extends IdSpace>(
  analysis: Analysis<I>,
  id: I["element"],
): readonly I["element"][] =>
  lookup(analysis.liveNeeds, id).filter(
    (need) => lookup(analysis.statuses, need) !== "done",
  );

/**
 * The elements that can be worked on now: every element whose status is `ready`, in model order. Pure control elements (decisions and pseudo-states) are derived `done` and never appear.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @returns The ready elements.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const readySet = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
): readonly I["element"][] =>
  [...analyse({ model, overlay, facts }).statuses]
    .filter(([, status]) => status === "ready")
    .map(([id]) => id);

/**
 * What is holding an element back: the minimal set of open elements to finish first.
 *
 * Starting from the element's unfinished needs, follows each one's own unfinished needs until it reaches elements that wait on nothing further, and returns exactly those leaves, in model order. Cut transitions (a branch not taken, a skipped source) and provided artefacts are not needs. A leaf is open work that is `ready`, or an element whose own state or condition is `unknown`. An element that is `done`, `skipped` or `ready` is blocked by nothing, and neither is one whose only obstacle is its own unknown state.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @param id - The element asked about.
 * @returns The leaves of the unfinished-needs closure, in model order.
 * @throws UnknownNodeError when `id` is not an element.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const blockedBy = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
  id: I["element"],
): readonly I["element"][] => {
  const analysis = analyse({ model, overlay, facts });
  if (!isLive(lookup(analysis.statuses, id))) {
    // A finished or skipped element waits on nothing, even when the overlay marked it done ahead of its needs or it consumes an artefact still to be made.
    return [];
  }
  const leaves = new Set<I["element"]>();
  const seen = new Set<I["element"]>();
  const pending = [...waitingOn(analysis, id)];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    const further = waitingOn(analysis, next);
    if (further.length === 0) {
      leaves.add(next);
    } else {
      pending.push(...further);
    }
  }

  return analysis.dag.nodes.filter((node) => leaves.has(node));
};

/**
 * What finishing, delaying or dropping an element affects: the elements that transitively depend on it through paths that are still live.
 *
 * Traversal follows each dependent's live needs (see `Analysis.liveNeeds`), so a transition cut by a branch not taken, a skipped element and a loop edge carry no impact, and an element already `done` is neither affected nor traversed through. The element itself is not included.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @param id - The element asked about.
 * @returns The affected elements, in model order.
 * @throws UnknownNodeError when `id` is not an element.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const impact = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
  id: I["element"],
): readonly I["element"][] => {
  const analysis = analyse({ model, overlay, facts });
  lookup(analysis.statuses, id);
  const live = analysis.dag.nodes.filter((node) =>
    isLive(lookup(analysis.statuses, node)),
  );
  const affected = new Set<I["element"]>();
  const pending = [id];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const node of live) {
      if (
        !affected.has(node) &&
        node !== id &&
        lookup(analysis.liveNeeds, node).includes(next)
      ) {
        affected.add(node);
        pending.push(node);
      }
    }
  }

  return live.filter((node) => affected.has(node));
};

/** A status that changed. */
export interface StatusChange<I extends IdSpace> {
  readonly id: I["element"];
  readonly before: Status;
  readonly after: Status;
}

/** The effect of finishing one element. */
export interface WhatIf<I extends IdSpace> {
  /** Elements that were not ready and become ready, in model order. */
  readonly becomesReady: readonly I["element"][];
  /** Every element whose status changes, in model order. Includes the finished element itself unless it was done already. */
  readonly changes: readonly StatusChange<I>[];
}

/**
 * Derives the run again with an element marked `done` in the overlay and reports what changes. Nothing is mutated.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @param id - The element to finish.
 * @returns The elements that become ready and every status change.
 * @throws UnknownNodeError when `id` is not an element.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const whatIfDone = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
  id: I["element"],
): WhatIf<I> => {
  const before = analyse({ model, overlay, facts }).statuses;
  lookup(before, id);
  const after = analyse({
    model,
    overlay: { ...overlay, [id]: "done" },
    facts,
  }).statuses;
  const changes = [...after].flatMap(([element, status]) => {
    const was = lookup(before, element);

    return was === status ? [] : [{ id: element, before: was, after: status }];
  });

  return {
    becomesReady: changes
      .filter((change) => change.after === "ready")
      .map((change) => change.id),
    changes,
  };
};

/**
 * The heaviest chain through the work that is still ahead: the live elements, those that are neither `done` nor `skipped`, ordered by the live needs that are themselves live.
 *
 * A finished or skipped element contributes nothing and does not appear. The chain is computed with `graph-dag`'s `criticalPath`, so its tie-breaking rule holds (the earliest element in model order wins).
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @param weight - The cost of an element: finite and not negative.
 * @returns The path in dependency order and its total weight; empty when nothing is live.
 * @throws RangeError when `weight` returns a negative or non-finite number.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const criticalPath = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
  weight: (id: I["element"]) => number,
): CriticalPath<I["element"]> => {
  const analysis = analyse({ model, overlay, facts });
  const live = analysis.dag.nodes.filter((node) =>
    isLive(lookup(analysis.statuses, node)),
  );

  return longestPath(
    buildDag(live, (id) =>
      lookup(analysis.liveNeeds, id).filter((need) =>
        isLive(lookup(analysis.statuses, need)),
      ),
    ),
    weight,
  );
};

/** A deliverable artefact that has not been produced yet and what it still takes. */
export interface UnmetOutput<I extends IdSpace> {
  readonly artefact: I["artefact"];
  /** The activities that declare they produce it. Empty when none does, so it can never be produced. */
  readonly producers: readonly I["element"][];
  /** The open elements still needed to produce it: its unfinished producers and, transitively, every unfinished live need of those, in model order. */
  readonly needed: readonly I["element"][];
  /** The artefacts among those needs that nothing produces and the run has not provided, in declaration order. */
  readonly missingInputs: readonly I["artefact"][];
}

/**
 * Every deliverable artefact that is still to be produced, with what is needed to produce it.
 *
 * A deliverable is met when it is provided or one of its producers is `done`. An unmet one lists its producers, the unfinished elements that must finish (its unfinished producers and everything those transitively wait on, skipped elements excluded) and the inputs that no one produces and nobody has provided, so a deliverable that can only ever be reached through an unproduced input shows exactly which input is missing.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @returns One entry per unmet deliverable, in declaration order.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const unmetOutputs = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
): readonly UnmetOutput<I>[] => {
  const analysis = analyse({ model, overlay, facts });
  const producersOf = (artefact: I["artefact"]): readonly I["element"][] =>
    model.elements.flatMap((element) =>
      element.kind === "activity" &&
      element.produces?.includes(artefact) === true
        ? [element.id]
        : [],
    );
  const unmet: UnmetOutput<I>[] = [];
  for (const { id: artefact, deliverable } of model.artefacts) {
    const producers = producersOf(artefact);
    if (
      deliverable !== true ||
      isProvided(facts, artefact) ||
      producers.some((id) => lookup(analysis.statuses, id) === "done")
    ) {
      continue;
    }
    const needed = new Set<I["element"]>();
    const pending = producers.filter((id) =>
      isLive(lookup(analysis.statuses, id)),
    );
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (needed.has(next)) {
        continue;
      }
      needed.add(next);
      pending.push(...waitingOn(analysis, next));
    }
    const wanted = new Set<I["artefact"]>();
    for (const element of model.elements) {
      if (element.kind !== "activity" || !needed.has(element.id)) {
        continue;
      }
      for (const consumed of element.consumes ?? []) {
        if (
          !isProvided(facts, consumed) &&
          producersOf(consumed).length === 0
        ) {
          wanted.add(consumed);
        }
      }
    }
    unmet.push({
      artefact,
      producers,
      needed: analysis.dag.nodes.filter((id) => needed.has(id)),
      missingInputs: [...wanted],
    });
  }

  return unmet;
};
