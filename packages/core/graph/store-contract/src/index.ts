/**
 * The `GraphStore` port: how process models and their run state are kept. It is an oRPC router contract, so one definition is served in process, across a message port to a worker, or over HTTP with no change to its consumers. Adapters implement `GraphStore`; `createGraphStoreRouter` builds the port on it.
 *
 * The conformance kit every adapter must pass is the separate `./conformance` entry point, so the runtime entry carries no test framework.
 */
export { graphStoreContract, type GraphStoreClient } from "./contract.ts";
export {
  boundActivitySchema,
  boundItemsSchema,
  changeKinds,
  factChangeSchema,
  factClearingSchema,
  factNameSchema,
  factRecordSchema,
  issueSchema,
  modelIdSchema,
  modelSummarySchema,
  reachSchema,
  relationKinds,
  relationSchema,
  revisionSchema,
  storeChangeSchema,
  storedFactsSchema,
  storedModelSchema,
  type BoundActivity,
  type BoundItems,
  type ChangeKind,
  type FactChange,
  type FactClearing,
  type ModelId,
  type ModelSummary,
  type Reach,
  type Relation,
  type RelationKind,
  type Revision,
  type StoreChange,
  type StoredFacts,
  type StoredModel,
} from "./schema.ts";
export { GraphStoreError, type GraphStoreFailure } from "./errors.ts";
export {
  ChangeFeed,
  defaultSubscriptionCapacity,
  type ChangeFeedOptions,
  type ChangeSubscription,
  type SubscribeOptions,
} from "./feed.ts";
export type { ElementRequest, GraphStore, ModelRequest } from "./store.ts";
export {
  checkStored,
  emptyModel,
  mergeBoundItems,
  overlayWithin,
} from "./merge.ts";
export { factIssues, factsWithin, mergeFacts, withoutFacts } from "./facts.ts";
export {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  mergeRelations,
  relationIssues,
  relationsWithin,
} from "./hierarchy.ts";
export {
  blockedChainOf,
  impactOf,
  readyOf,
  structureOf,
  type Structure,
} from "./structure.ts";
export { createGraphStoreRouter, type GraphStoreRouter } from "./router.ts";
export { createFakeGraphStore } from "./fake.ts";
