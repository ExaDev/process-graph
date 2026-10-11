import type { FactRecord } from "@exadev/process-graph-domain";
import type {
  ArtefactDef,
  Element,
  EventDef,
  Model,
  OpenIds,
  OverlayStatus,
  Participant,
  Transition,
} from "@exadev/process-graph-schema";
import { emptyModel } from "@exadev/process-graph-store-contract";
import type { ComputedValue } from "trilean";
import { CliError } from "./errors.ts";
import { exitCodes } from "./exit-codes.ts";
import {
  callOptions,
  findRun,
  loadRun,
  requireElement,
  type GraphSession,
} from "./session.ts";

/** A record to add to the model, by the part of the model it belongs to. */
export type Addition =
  | { readonly kind: "participant"; readonly record: Participant<string> }
  | { readonly kind: "element"; readonly record: Element<string, OpenIds> }
  | { readonly kind: "event"; readonly record: EventDef<string> }
  | { readonly kind: "artefact"; readonly record: ArtefactDef<string> }
  | {
      readonly kind: "transition";
      readonly record: Transition<string, OpenIds>;
    };

/** A change the store accepted. */
export interface Written {
  /** The revision the change took. */
  readonly revision: number;
}

/** The model with one record appended to the part it belongs to. */
const withAddition = (
  model: Model<OpenIds>,
  addition: Addition,
): Model<OpenIds> => {
  if (addition.kind === "participant") {
    return { ...model, participants: [...model.participants, addition.record] };
  }
  if (addition.kind === "element") {
    return { ...model, elements: [...model.elements, addition.record] };
  }
  if (addition.kind === "event") {
    return { ...model, events: [...model.events, addition.record] };
  }
  if (addition.kind === "artefact") {
    return { ...model, artefacts: [...model.artefacts, addition.record] };
  }

  return { ...model, transitions: [...model.transitions, addition.record] };
};

/**
 * Adds a record to the session's model, creating the model when the store has none. The store checks the result, so a duplicate identifier or a reference to something undeclared is rejected and nothing changes.
 *
 * The model is read and then saved whole, so a write made by another process between the two is overwritten.
 * @param session - The store and model.
 * @param addition - The record to add.
 * @returns The revision the save took.
 */
export const add = async (
  session: GraphSession,
  addition: Addition,
): Promise<Written> => {
  // A store with no such model yet starts it from the empty model, as a sync does.
  const model = (await findRun(session))?.model ?? emptyModel;

  return session.store.v1.models.save(
    { modelId: session.modelId, model: withAddition(model, addition) },
    callOptions(session.signal),
  );
};

/** The run state an element was given. */
export interface SetResult extends Written {
  readonly element: string;
  readonly state: OverlayStatus;
}

/**
 * Sets an element's run state, leaving every other element's as it is.
 * @param session - The store and model.
 * @param id - The element.
 * @param state - `done`, `open` or `unknown`.
 * @returns The element, its new state and the revision the change took.
 * @throws CliError with `notFound` when the model or the element does not exist.
 */
export const setState = async (
  session: GraphSession,
  id: string,
  state: OverlayStatus,
): Promise<SetResult> => {
  const { model } = await loadRun(session);
  requireElement(model, id);
  const { revision } = await session.store.v1.overlay.set(
    { modelId: session.modelId, overlay: { [id]: state } },
    callOptions(session.signal),
  );

  return { element: id, state, revision };
};

/** What can be recorded about an artefact: `provided`, known not provided (`absent`), or `unknown`, which forgets whatever was recorded. */
export const artefactStates = ["provided", "absent", "unknown"] as const;

/** One of `artefactStates`. */
export type ArtefactState = (typeof artefactStates)[number];

/** The state an artefact was given. */
export interface SetArtefactResult extends Written {
  readonly artefact: string;
  readonly state: ArtefactState;
}

/**
 * Records whether an artefact of the session's model is provided, so a consumer of an input no activity produces can become ready, or forgets it with `unknown`.
 * @param session - The store and model.
 * @param id - The artefact.
 * @param state - `provided`, `absent` or `unknown`.
 * @returns The artefact, its new state and the revision the change took.
 * @throws CliError with `notFound` when the model or the artefact does not exist.
 */
export const setArtefact = async (
  session: GraphSession,
  id: string,
  state: ArtefactState,
): Promise<SetArtefactResult> => {
  const { model } = await loadRun(session);
  if (!model.artefacts.some((artefact) => artefact.id === id)) {
    throw new CliError(exitCodes.notFound, `no artefact "${id}" in the model`);
  }
  const options = callOptions(session.signal);
  const { revision } =
    state === "unknown"
      ? await session.store.v1.facts.clear(
          { modelId: session.modelId, facts: { artefacts: [id] } },
          options,
        )
      : await session.store.v1.facts.set(
          {
            modelId: session.modelId,
            facts: { artefacts: { [id]: state === "provided" } },
          },
          options,
        );

  return { artefact: id, state, revision };
};

/** The value a named fact was given, or `unknown` when it was forgotten. */
export interface SetFactResult extends Written {
  readonly fact: string;
  readonly value: ComputedValue | "unknown";
}

/**
 * Records a named fact's value for the session's model, so every condition reading that name evaluates against it, or forgets it with `unknown`, so those conditions are indeterminate again.
 * @param session - The store and model.
 * @param name - The fact's name, the key a condition's `reference` node gives.
 * @param value - Its trilean value, or `unknown`.
 * @returns The fact, its new value and the revision the change took.
 * @throws CliError with `notFound` when the model does not exist.
 */
export const setFact = async (
  session: GraphSession,
  name: string,
  value: ComputedValue | "unknown",
): Promise<SetFactResult> => {
  await loadRun(session);
  const options = callOptions(session.signal);
  const { revision } =
    value === "unknown"
      ? await session.store.v1.facts.clear(
          { modelId: session.modelId, facts: { values: [name] } },
          options,
        )
      : await session.store.v1.facts.set(
          { modelId: session.modelId, facts: { values: { [name]: value } } },
          options,
        );

  return { fact: name, value, revision };
};

/** The session's model's fact record. */
export interface FactsResult {
  readonly revision: number;
  readonly facts: FactRecord;
}

/**
 * Reads what is recorded about the session's model's run: which artefacts are provided or absent, and each named fact's value.
 * @param session - The store and model.
 * @returns The fact record and the model's revision.
 * @throws CliError with `notFound` when the model does not exist.
 */
export const factsOf = async (session: GraphSession): Promise<FactsResult> => {
  const { revision, facts } = await loadRun(session);

  return { revision, facts };
};
