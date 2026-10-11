import {
  blockedBy,
  criticalPath,
  deriveStatuses,
  explainStatus,
  impact,
  readySet,
  type ChainLink,
  type Status,
  type StatusExplanation,
} from "@exadev/process-graph-domain";
import type { CriticalPath } from "@exadev/process-graph-dag";
import type { IdSpace } from "@exadev/process-graph-schema";
import { useMemo } from "react";
import type { Run } from "./run.ts";

/**
 * The status of every element in a run, derived by `deriveStatuses`.
 * @param run - The model, overlay and facts.
 * @returns Each element's status, in model order.
 * @throws CycleError when the model has an illegal cycle, so an error boundary shows it.
 */
export const useStatuses = <I extends IdSpace>(
  run: Run<I>,
): ReadonlyMap<I["element"], Status> => {
  const { model, overlay, facts } = run;

  return useMemo(
    () => deriveStatuses(model, overlay, facts),
    [model, overlay, facts],
  );
};

/**
 * The work that can start now, by `readySet`.
 * @param run - The model, overlay and facts.
 * @returns The ready elements, in model order.
 */
export const useReadySet = <I extends IdSpace>(
  run: Run<I>,
): readonly I["element"][] => {
  const { model, overlay, facts } = run;

  return useMemo(
    () => readySet(model, overlay, facts),
    [model, overlay, facts],
  );
};

/**
 * Why an element has its status, by `explainStatus`.
 * @param run - The model, overlay and facts.
 * @param id - The element asked about, or `undefined` when nothing is.
 * @returns The explanation, or `undefined` when `id` is.
 * @throws UnknownNodeError when `id` is not an element of the model.
 */
export const useWhyStatus = <I extends IdSpace>(
  run: Run<I>,
  id: I["element"] | undefined,
): StatusExplanation<I> | undefined => {
  const { model, overlay, facts } = run;

  return useMemo(
    () =>
      id === undefined ? undefined : explainStatus(model, overlay, facts, id),
    [model, overlay, facts, id],
  );
};

/** The unfinished work behind an element. */
export interface BlockedChain<I extends IdSpace> {
  /** The element, then every unfinished need reached from it, each with the needs it still waits on; see `explainStatus`. */
  readonly chain: readonly ChainLink<I>[];
  /** The open work at the end of the chain, which waits on nothing further: what to finish first. The same elements `blockedBy` returns. */
  readonly blockers: readonly I["element"][];
}

/**
 * The unfinished work holding an element back: the whole chain and the blockers at its end.
 * @param run - The model, overlay and facts.
 * @param id - The element asked about, or `undefined` when nothing is.
 * @returns The chain and its blockers; both empty when `id` is `undefined`.
 * @throws UnknownNodeError when `id` is not an element of the model.
 */
export const useBlockedChain = <I extends IdSpace>(
  run: Run<I>,
  id: I["element"] | undefined,
): BlockedChain<I> => {
  const explanation = useWhyStatus(run, id);

  return useMemo(() => {
    if (explanation === undefined) {
      return { chain: [], blockers: [] };
    }
    const [, ...behind] = explanation.chain;

    return {
      chain: explanation.chain,
      blockers: behind
        .filter((link) => link.waitingOn.length === 0)
        .map((link) => link.element),
    };
  }, [explanation]);
};

/**
 * What every blocked element is blocked by, by `blockedBy`, for a view that shows each element's blockers beside it.
 * @param run - The model, overlay and facts.
 * @returns The open work at the end of each blocked element's chain, keyed by the blocked element, in model order. Elements that are not blocked are absent.
 */
export const useBlockers = <I extends IdSpace>(
  run: Run<I>,
): ReadonlyMap<I["element"], readonly I["element"][]> => {
  const statuses = useStatuses(run);
  const { model, overlay, facts } = run;

  return useMemo(
    () =>
      new Map(
        [...statuses]
          .filter(([, status]) => status === "blocked")
          .map(([id]) => [id, blockedBy(model, overlay, facts, id)]),
      ),
    [statuses, model, overlay, facts],
  );
};

/**
 * The live work that transitively depends on an element, by `impact`.
 * @param run - The model, overlay and facts.
 * @param id - The element asked about, or `undefined` when nothing is.
 * @returns The impacted elements; empty when `id` is `undefined`.
 * @throws UnknownNodeError when `id` is not an element of the model.
 */
export const useImpact = <I extends IdSpace>(
  run: Run<I>,
  id: I["element"] | undefined,
): readonly I["element"][] => {
  const { model, overlay, facts } = run;

  return useMemo(
    () => (id === undefined ? [] : impact(model, overlay, facts, id)),
    [model, overlay, facts, id],
  );
};

/**
 * Every element weighs one step, so the critical path is the longest chain of work still ahead.
 * @returns One.
 */
export const stepWeight = (): number => 1;

/**
 * The heaviest chain through the work still ahead, by `criticalPath`.
 * @param run - The model, overlay and facts.
 * @param weight - The cost of an element, finite and not negative. Keep it stable between renders. Defaults to `stepWeight`.
 * @returns The path in dependency order and its total weight; empty when nothing is live.
 * @throws RangeError when `weight` returns a negative or non-finite number.
 */
export const useCriticalPath = <I extends IdSpace>(
  run: Run<I>,
  weight: (id: I["element"]) => number = stepWeight,
): CriticalPath<I["element"]> => {
  const { model, overlay, facts } = run;

  return useMemo(
    () => criticalPath(model, overlay, facts, weight),
    [model, overlay, facts, weight],
  );
};
