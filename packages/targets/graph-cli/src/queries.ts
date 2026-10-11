import {
  blockedBy,
  criticalPath,
  deriveStatuses,
  explainStatus,
  illegalCycles,
  impact,
  readySet,
  type ArtefactBasis,
  type IncomingBasis,
  type Status,
  type StatusRule,
} from "@exadev/process-graph-domain";
import { handoffs, type Handoff } from "@exadev/process-graph-projection";
import type { OpenIds } from "@exadev/process-graph-schema";
import {
  callOptions,
  labelOf,
  loadRun,
  requireElement,
  runFacts,
  summarise,
  type ElementSummary,
  type GraphSession,
} from "./session.ts";

/** An element with its derived status. */
export interface ElementStatus extends ElementSummary {
  readonly status: Status;
}

/** Every element that can be worked on now. */
export interface ReadyResult {
  readonly elements: readonly ElementSummary[];
}

/** What an element is waiting on. */
export interface BlockedResult {
  readonly element: ElementStatus;
  /** The open work to finish first: the ends of the element's blocked-by chain, in model order. */
  readonly blockedBy: readonly ElementSummary[];
}

/** What finishing, delaying or dropping an element affects. */
export interface ImpactResult {
  readonly element: ElementStatus;
  /** The live elements that transitively depend on it, in model order. */
  readonly impacted: readonly ElementSummary[];
}

/** The longest chain of work still ahead. */
export interface PathResult {
  /** The chain in dependency order. */
  readonly path: readonly ElementSummary[];
  /** Its length in elements, each counting one step. */
  readonly weight: number;
}

/** The cycles no decision closes. */
export interface CyclesResult {
  /** Each cycle as a closed path: each element needs the next, and the first is repeated at the end. */
  readonly cycles: readonly (readonly string[])[];
}

/** The transitions between elements with different actors. */
export interface HandoffsResult {
  readonly handoffs: readonly Handoff<OpenIds>[];
}

/** One element of a blocked-by chain, with its label and status. */
export interface WhyLink extends ElementStatus {
  /** The unfinished needs it still waits on, in model order. */
  readonly waitingOn: readonly string[];
}

/** Why an element has its status. */
export interface WhyResult {
  readonly element: ElementStatus;
  /** The rule of the status derivation that decided it. */
  readonly rule: StatusRule;
  /** Its incoming transitions other than loop edges, each with its branch, its source's status and whether it is cut. */
  readonly transitions: readonly IncomingBasis<OpenIds>[];
  /** The artefacts it consumes, each with whether it is provided and its producers' statuses. */
  readonly artefacts: readonly ArtefactBasis<OpenIds>[];
  /** The element, then every unfinished need reached from it, in model order. */
  readonly chain: readonly WhyLink[];
}

/** An element of a hierarchy walk, with how many `child-of` relations away it is. */
export interface HierarchyLink extends ElementSummary {
  readonly distance: number;
}

/** An element's sub-tasks: the elements related to it by `child-of`. */
export interface ChildrenResult {
  readonly element: ElementSummary;
  /** Its direct children, in model order. */
  readonly children: readonly ElementSummary[];
}

/** What an element is a sub-task of, up to the top of its hierarchy. */
export interface AncestorsResult {
  readonly element: ElementSummary;
  /** Its parent, its parent's parent and so on, nearest first, each once with the fewest relations it takes to reach it. */
  readonly ancestors: readonly HierarchyLink[];
}

/** Each element counts as one step, so the critical path is the longest chain of elements. */
const stepWeight = 1;

/**
 * The elements that are ready: not done, with every live need done.
 * @param session - The store, model and facts.
 */
export const ready = async (session: GraphSession): Promise<ReadyResult> => {
  const run = await loadRun(session);
  const { model, overlay } = run;

  return {
    elements: summarise(
      model,
      readySet(model, overlay, runFacts(session, run)),
    ),
  };
};

const statusOf = (
  statuses: ReadonlyMap<string, Status>,
  summary: ElementSummary,
): ElementStatus => {
  const status = statuses.get(summary.id);
  if (status === undefined) {
    throw new Error(`no status was derived for "${summary.id}"`);
  }

  return { ...summary, status };
};

/**
 * What an element is waiting on.
 * @param session - The store, model and facts.
 * @param id - The element asked about.
 */
export const blocked = async (
  session: GraphSession,
  id: string,
): Promise<BlockedResult> => {
  const run = await loadRun(session);
  const { model, overlay } = run;
  const facts = runFacts(session, run);
  const element = requireElement(model, id);
  const statuses = deriveStatuses(model, overlay, facts);

  return {
    element: statusOf(statuses, { id, label: labelOf(element) }),
    blockedBy: summarise(model, blockedBy(model, overlay, facts, id)),
  };
};

/**
 * What depends on an element.
 * @param session - The store, model and facts.
 * @param id - The element asked about.
 */
export const impactOf = async (
  session: GraphSession,
  id: string,
): Promise<ImpactResult> => {
  const run = await loadRun(session);
  const { model, overlay } = run;
  const facts = runFacts(session, run);
  const element = requireElement(model, id);
  const statuses = deriveStatuses(model, overlay, facts);

  return {
    element: statusOf(statuses, { id, label: labelOf(element) }),
    impacted: summarise(model, impact(model, overlay, facts, id)),
  };
};

/**
 * The critical path: the longest chain through the work still ahead.
 * @param session - The store, model and facts.
 */
export const path = async (session: GraphSession): Promise<PathResult> => {
  const run = await loadRun(session);
  const { model, overlay } = run;
  const found = criticalPath(
    model,
    overlay,
    runFacts(session, run),
    () => stepWeight,
  );

  return { path: summarise(model, found.path), weight: found.weight };
};

/**
 * The cycles of the model that no decision closes, which make every status undefined.
 * @param session - The store and model.
 */
export const cycles = async (session: GraphSession): Promise<CyclesResult> => {
  const { model } = await loadRun(session);

  return { cycles: illegalCycles(model) };
};

/**
 * The hand-offs: transitions from one actor's work to another's.
 * @param session - The store and model.
 */
export const handoffsOf = async (
  session: GraphSession,
): Promise<HandoffsResult> => {
  const { model } = await loadRun(session);

  return { handoffs: handoffs(model) };
};

/**
 * Why an element has its status, and the chain of unfinished work behind it.
 * @param session - The store, model and facts.
 * @param id - The element asked about.
 */
export const why = async (
  session: GraphSession,
  id: string,
): Promise<WhyResult> => {
  const run = await loadRun(session);
  const { model, overlay } = run;
  requireElement(model, id);
  const explained = explainStatus(model, overlay, runFacts(session, run), id);
  const chain = explained.chain.map((link) => ({
    id: link.element,
    label: labelOf(requireElement(model, link.element)),
    status: link.status,
    waitingOn: link.waitingOn,
  }));
  const [first] = chain;
  if (first === undefined) {
    throw new Error(`the explanation of "${id}" has no chain`);
  }

  return {
    element: { id: first.id, label: first.label, status: first.status },
    rule: explained.rule,
    transitions: explained.transitions,
    artefacts: explained.artefacts,
    chain,
  };
};

/**
 * An element's direct sub-tasks, from the `child-of` relations a sync keeps, as the store's hierarchy query answers.
 * @param session - The store and model.
 * @param id - The element asked about.
 * @throws CliError with `notFound` when the model or the element does not exist.
 */
export const children = async (
  session: GraphSession,
  id: string,
): Promise<ChildrenResult> => {
  const { model } = await loadRun(session);
  const element = requireElement(model, id);
  const found = await session.store.v1.query.children(
    { modelId: session.modelId, element: id },
    callOptions(session.signal),
  );

  return {
    element: { id, label: labelOf(element) },
    children: summarise(model, found.children),
  };
};

/**
 * The elements an element is a sub-task of, nearest first, from the `child-of` relations a sync keeps, as the store's hierarchy query answers.
 * @param session - The store and model.
 * @param id - The element asked about.
 * @throws CliError with `notFound` when the model or the element does not exist.
 */
export const ancestors = async (
  session: GraphSession,
  id: string,
): Promise<AncestorsResult> => {
  const { model } = await loadRun(session);
  const element = requireElement(model, id);
  const found = await session.store.v1.query.ancestors(
    { modelId: session.modelId, element: id },
    callOptions(session.signal),
  );

  return {
    element: { id, label: labelOf(element) },
    ancestors: found.ancestors.map((link) => ({
      id: link.element,
      label: labelOf(requireElement(model, link.element)),
      distance: link.distance,
    })),
  };
};
