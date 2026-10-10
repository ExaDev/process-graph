import type { IdSpace, Model, Overlay } from "@exadev/process-graph-schema";
import {
  analyse,
  type ArtefactBasis,
  type IncomingBasis,
  type StatusRule,
} from "./derive.ts";
import type { Facts } from "./facts.ts";
import { lookup } from "./lookup.ts";
import { waitingOn } from "./progress.ts";
import type { Status } from "./status.ts";

/** One element of a blocked-by chain and the unfinished needs it still waits on. */
export interface ChainLink<I extends IdSpace> {
  readonly element: I["element"];
  readonly status: Status;
  /** The element's live needs that are not done, in model order. Empty for the open work at the end of the chain. */
  readonly waitingOn: readonly I["element"][];
}

/** Why an element has the status it has. */
export interface StatusExplanation<I extends IdSpace> {
  readonly element: I["element"];
  readonly status: Status;
  /** The rule that decided the status. */
  readonly rule: StatusRule;
  /** The element's incoming transitions other than loop edges, each with its branch, its source's status and whether it is cut, in model order. */
  readonly transitions: readonly IncomingBasis<I>[];
  /** The artefacts the element consumes, each with whether it is provided and its producers' statuses. */
  readonly artefacts: readonly ArtefactBasis<I>[];
  /**
   * The blocked-by chain: the element, then every unfinished need reached from it by following unfinished needs, in model order. The links after the first that wait on nothing are the elements `blockedBy` returns. A done or skipped element waits on nothing, so its chain is the element alone.
   */
  readonly chain: readonly ChainLink<I>[];
}

/**
 * Explains an element's status: the rule that decided it, the transitions and artefacts it was decided from, and the chain of unfinished work behind it. The explanation is the derivation's own record, so it always agrees with `deriveStatuses` and `blockedBy`.
 * @param model - The model to read.
 * @param overlay - Run state by element id.
 * @param facts - The injected source of facts conditions read, and of which input artefacts are provided.
 * @param id - The element asked about.
 * @returns The explanation.
 * @throws UnknownNodeError when `id` is not an element.
 * @throws CycleError when the control graph has an illegal cycle.
 */
export const explainStatus = <I extends IdSpace>(
  model: Model<I>,
  overlay: Readonly<Overlay<I>>,
  facts: Facts,
  id: I["element"],
): StatusExplanation<I> => {
  const analysis = analyse({ model, overlay, facts });
  const basis = lookup(analysis.basis, id);
  const reached = new Map<I["element"], readonly I["element"][]>();
  const pending = [id];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (reached.has(next)) {
      continue;
    }
    const needs = waitingOn(analysis, next);
    reached.set(next, needs);
    pending.push(...needs);
  }
  const link = (element: I["element"]): ChainLink<I> => ({
    element,
    status: lookup(analysis.statuses, element),
    waitingOn: analysis.dag.nodes.filter((node) =>
      lookup(reached, element).includes(node),
    ),
  });

  return {
    element: id,
    status: lookup(analysis.statuses, id),
    rule: basis.rule,
    transitions: basis.transitions,
    artefacts: basis.artefacts,
    chain: [
      link(id),
      ...analysis.dag.nodes
        .filter((node) => node !== id && reached.has(node))
        .map(link),
    ],
  };
};
