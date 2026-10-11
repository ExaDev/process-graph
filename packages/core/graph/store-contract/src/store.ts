import type { Model, OpenIds, Overlay } from "@exadev/process-graph-schema";
import type { ChangeFeed } from "./feed.ts";
import type {
  BoundItems,
  FactChange,
  FactClearing,
  ModelSummary,
  Reach,
  Relation,
  Revision,
  StoredFacts,
  StoredModel,
} from "./schema.ts";

/** What every store request carries: the model it is about and the caller's abort signal. */
export interface ModelRequest {
  readonly modelId: string;
  /** Fires when the caller gives up. A write checks it before committing, so an aborted write changes nothing. */
  readonly signal: AbortSignal | undefined;
}

/** A request about one element of a model. */
export interface ElementRequest extends ModelRequest {
  readonly element: string;
}

/**
 * What a store adapter implements. `createGraphStoreRouter` builds the whole port on it, so validation, error mapping, abort handling and change subscriptions behave identically for every store.
 *
 * Every write is atomic: it checks the result with `checkStored` (and `relationIssues` for the relations it stores) and throws `GraphStoreError` with `invalid` before anything is visible, takes the next store-wide revision, and publishes the change to `feed` after it commits. A read or query of a model that does not exist, or of an element the model does not declare, throws `GraphStoreError` with `not-found`.
 */
export interface GraphStore {
  /** The feed this store publishes its committed changes to. */
  readonly feed: ChangeFeed;
  /**
   * Lists the stored models.
   * @returns Every model's id and revision, ordered by id.
   */
  readonly listModels: (request: {
    readonly signal: AbortSignal | undefined;
  }) => Promise<readonly ModelSummary[]>;
  /**
   * Stores a model under an id, replacing any model stored there and dropping the run state, relations and artefact facts of what the new model does not declare (see `overlayWithin`, `relationsWithin` and `factsWithin`).
   * @returns The revision the save took.
   */
  readonly saveModel: (
    request: ModelRequest & { readonly model: Model<OpenIds> },
  ) => Promise<Revision>;
  /**
   * Reads a model back exactly as saved or merged, in its declared order, with its run state and its fact record.
   * @returns The model, its overlay, its facts and its revision.
   */
  readonly loadModel: (request: ModelRequest) => Promise<StoredModel>;
  /**
   * Removes a model, its run state, its relations and its facts.
   * @returns The revision the deletion took, or `undefined` when there was no such model and nothing changed.
   */
  readonly deleteModel: (
    request: ModelRequest,
  ) => Promise<Revision | undefined>;
  /**
   * Sets the run state of the elements an overlay names, leaving the others as they are.
   * @returns The revision the change took.
   */
  readonly applyOverlay: (
    request: ModelRequest & { readonly overlay: Overlay<OpenIds> },
  ) => Promise<Revision>;
  /**
   * A model's fact record.
   * @returns The record and the model's revision.
   */
  readonly readFacts: (request: ModelRequest) => Promise<StoredFacts>;
  /**
   * Records facts about a model's run (see `mergeFacts`). Every artefact named must be one the model declares (`factIssues`); otherwise nothing is written.
   * @returns The revision the change took.
   */
  readonly setFacts: (
    request: ModelRequest & { readonly facts: FactChange },
  ) => Promise<Revision>;
  /**
   * Forgets facts about a model's run, so what they named is unknown again (see `withoutFacts`).
   * @returns The revision the change took.
   */
  readonly clearFacts: (
    request: ModelRequest & { readonly facts: FactClearing },
  ) => Promise<Revision>;
  /**
   * Merges items read from a source into a model by id (see `mergeBoundItems`), and adds their relations (see `mergeRelations`), creating the model from an empty one when it does not exist. Every relation stored must name what the merged model declares (`relationIssues`); otherwise nothing is written.
   * @returns The revision the change took.
   */
  readonly upsertItems: (
    request: ModelRequest & { readonly items: BoundItems },
  ) => Promise<Revision>;
  /**
   * The relations kept beside a model.
   * @returns The relations, in the order they were first stored.
   */
  readonly relations: (request: ModelRequest) => Promise<readonly Relation[]>;
  /**
   * The direct children of an element (see `childrenOf`).
   * @returns The children, in model order.
   */
  readonly children: (request: ElementRequest) => Promise<readonly string[]>;
  /**
   * Everything beneath an element along `child-of` relations (see `descendantsOf`).
   * @returns The descendants, by distance and then model order.
   */
  readonly descendants: (request: ElementRequest) => Promise<readonly Reach[]>;
  /**
   * Everything above an element along `child-of` relations (see `ancestorsOf`).
   * @returns The ancestors, by distance and then model order.
   */
  readonly ancestors: (request: ElementRequest) => Promise<readonly Reach[]>;
  /**
   * The work that can start now (see `readyOf`).
   * @returns The ready elements, in model order.
   */
  readonly ready: (request: ModelRequest) => Promise<readonly string[]>;
  /**
   * The unfinished work upstream of an element (see `blockedChainOf`).
   * @returns The chain, by distance and then model order.
   */
  readonly blockedChain: (request: ElementRequest) => Promise<readonly Reach[]>;
  /**
   * The unfinished work downstream of an element (see `impactOf`).
   * @returns The impacted elements, by distance and then model order.
   */
  readonly impact: (request: ElementRequest) => Promise<readonly Reach[]>;
  /**
   * The revision of a model's last change.
   * @returns The revision, or `undefined` when there is no such model.
   */
  readonly revisionOf: (request: ModelRequest) => Promise<Revision | undefined>;
}
