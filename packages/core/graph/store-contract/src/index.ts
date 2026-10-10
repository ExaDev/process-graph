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
  issueSchema,
  modelIdSchema,
  modelSummarySchema,
  reachSchema,
  revisionSchema,
  storeChangeSchema,
  storedModelSchema,
  type BoundActivity,
  type BoundItems,
  type ChangeKind,
  type ModelId,
  type ModelSummary,
  type Reach,
  type Revision,
  type StoreChange,
  type StoredModel,
} from "./schema.ts";
export { GraphStoreError, type GraphStoreFailure } from "./errors.ts";
export { ChangeFeed, type ChangeSubscription } from "./feed.ts";
export type { ElementRequest, GraphStore, ModelRequest } from "./store.ts";
export {
  checkStored,
  emptyModel,
  mergeBoundItems,
  overlayWithin,
} from "./merge.ts";
export {
  blockedChainOf,
  impactOf,
  readyOf,
  structureOf,
  type Structure,
} from "./structure.ts";
export { createGraphStoreRouter, type GraphStoreRouter } from "./router.ts";
export { createFakeGraphStore } from "./fake.ts";
