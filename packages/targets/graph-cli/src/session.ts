import {
  factsFrom,
  layeredFacts,
  type FactRecord,
  type Facts,
} from "@exadev/process-graph-domain";
import type {
  Element,
  Model,
  OpenIds,
  Overlay,
} from "@exadev/process-graph-schema";
import type { GraphStoreClient } from "@exadev/process-graph-store-contract";
import { ORPCError } from "@orpc/server";
import { CliError } from "./errors.ts";
import { exitCodes } from "./exit-codes.ts";

/** What every operation works against: one model in one store, the facts a host supplies for its conditions, and the signal that aborts its calls. */
export interface GraphSession {
  readonly store: GraphStoreClient;
  /** The name the model is filed under in the store. */
  readonly modelId: string;
  /** Facts the host supplies, consulted for whatever the model's stored fact record does not answer (see `runFacts`). */
  readonly facts: Facts;
  readonly signal: AbortSignal | undefined;
}

/** A stored model, its run state and its fact record, as an operation reads them. */
export interface StoredRun {
  readonly revision: number;
  readonly model: Model<OpenIds>;
  readonly overlay: Overlay<OpenIds>;
  readonly facts: FactRecord;
}

/**
 * The facts a run's reasoning reads: the model's stored fact record first, then the session's own facts for every key the record does not answer. What `set artefact` and `set fact` record therefore overrides a host's facts only where it says something.
 * @param session - The session, whose facts the host supplied.
 * @param run - The stored run.
 * @returns The `Facts` port for graph-domain.
 */
export const runFacts = (session: GraphSession, run: StoredRun): Facts =>
  layeredFacts(factsFrom(run.facts), session.facts);

/** An element as commands report it: its identifier and its human label. */
export interface ElementSummary {
  readonly id: string;
  readonly label: string;
}

/**
 * The oRPC client options carrying the session's signal. The key is left out when there is no signal, since the options type does not accept an explicit `undefined`.
 * @param signal - The signal, if any.
 */
export const callOptions = (
  signal: AbortSignal | undefined,
): { readonly signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

/**
 * Reads the session's model and run state, if the store has the model.
 * @param session - The store and model.
 * @returns The stored run, or `undefined` when the store has no such model.
 */
export const findRun = async (
  session: GraphSession,
): Promise<StoredRun | undefined> => {
  try {
    const stored = await session.store.v1.models.load(
      { modelId: session.modelId },
      callOptions(session.signal),
    );

    return {
      revision: stored.revision,
      model: stored.model,
      overlay: stored.overlay,
      facts: stored.facts,
    };
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
};

/**
 * Loads the session's model and run state.
 * @param session - The store and model.
 * @returns The stored run.
 * @throws CliError with `notFound` when the store has no such model.
 */
export const loadRun = async (session: GraphSession): Promise<StoredRun> => {
  const run = await findRun(session);
  if (run === undefined) {
    throw new CliError(
      exitCodes.notFound,
      `no model "${session.modelId}" in the store; sync or add something first`,
    );
  }

  return run;
};

/** The label an element is shown with: its own label, or for a pseudo-state, its role. */
export const labelOf = (element: Element<string, OpenIds>): string =>
  element.kind === "pseudo" ? element.role : element.label;

/**
 * Looks an element up by identifier.
 * @param model - The model to read.
 * @param id - The element asked about.
 * @returns The element.
 * @throws CliError with `notFound` when the model declares no such element.
 */
export const requireElement = (
  model: Model<OpenIds>,
  id: string,
): Element<string, OpenIds> => {
  const element = model.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new CliError(exitCodes.notFound, `no element "${id}" in the model`);
  }

  return element;
};

/**
 * Summaries of elements, in the order given.
 * @param model - The model the identifiers belong to.
 * @param ids - The element identifiers.
 */
export const summarise = (
  model: Model<OpenIds>,
  ids: readonly string[],
): readonly ElementSummary[] =>
  ids.map((id) => ({ id, label: labelOf(requireElement(model, id)) }));
