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
