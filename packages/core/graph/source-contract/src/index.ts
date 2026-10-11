/**
 * The `GraphSource` port: how the process model reads work from an external tracker. It is an oRPC router contract, so one definition is served in process, across a message port to a worker, or over HTTP with no change to its consumers. Adapters implement a `GraphSourcePager`, one page at a time; `createGraphSourceRouter` builds the port on it.
 *
 * The conformance kit every adapter must pass is the separate `./conformance` entry point, so the runtime entry carries no test framework.
 */
export { graphSourceContract, type GraphSourceClient } from "./contract.ts";
export {
  badRequestReasons,
  boundActivitySchema,
  filterStates,
  gapReasons,
  gapSchema,
  orderDirections,
  orderFields,
  participantSchema,
  relationKinds,
  relationSchema,
  scopeChildrenInputSchema,
  scopeEntrySchema,
  scopeListingSchema,
  scopeRootsInputSchema,
  sourceDescriptionSchema,
  syncFilterSchema,
  syncInputSchema,
  syncPageSchema,
  transitionSchema,
  type BadRequestReason,
  type BoundActivity,
  type FilterState,
  type Gap,
  type GapReason,
  type OrderDirection,
  type OrderField,
  type Relation,
  type RelationKind,
  type ScopeChildrenInput,
  type ScopeEntry,
  type ScopeListing,
  type ScopeListingInput,
  type ScopeRootsInput,
  type SourceDescription,
  type SourceParticipant,
  type SourceTransition,
  type SyncFilter,
  type SyncInput,
  type SyncPage,
} from "./schema.ts";
export { GraphSourceError, type GraphSourceFailure } from "./errors.ts";
export {
  createGraphSourceRouter,
  type ChildrenRequest,
  type GraphSourcePager,
  type GraphSourceRouter,
  type GraphSourceScopes,
  type ListingRequest,
  type PageRequest,
} from "./router.ts";
export { assembleSync, type AssembledSync } from "./assemble.ts";
export { paginate } from "./paginate.ts";
export {
  createFakeGraphSource,
  type FakeGraphSourceOptions,
  type FakePage,
} from "./fake.ts";
