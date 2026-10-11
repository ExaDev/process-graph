/**
 * Syncs work from `GraphSource`s into a `GraphStore`: page by page, resumable from a checkpoint, with an optional typed filter, writing participants, bound activities, transitions, relations and run state. One function serves every consumer, so the command line and the web app write a sync the same way.
 */
export {
  syncScopes,
  UnknownSourceError,
  type SourceLookup,
  type SyncProgress,
  type SyncRequest,
  type SyncStore,
} from "./sync.ts";
export { syncCheckpointSchema, type SyncCheckpoint } from "./checkpoint.ts";
export {
  InvalidScopeError,
  scopesBySource,
  type SourceScopes,
} from "./scopes.ts";
