import type {
  Gap,
  OrderDirection,
  SyncFilter,
} from "@exadev/process-graph-source-contract";
import {
  InterruptedSyncError,
  InvalidScopeError,
  scopesBySource,
  syncScopes,
  UnknownSourceError,
  type SourceLookup,
  type SourceScopes,
  type SyncCheckpoint,
} from "@exadev/process-graph-sync";
import { CliError, failureOf, underlyingCause } from "./errors.ts";
import { exitCodes } from "./exit-codes.ts";
import type { GraphSession } from "./session.ts";

/** What to sync. */
export interface SyncRequest {
  /** Source-qualified scope identifiers, such as `github:owner` or `github:owner/repo`, read in order. */
  readonly scopes: readonly string[];
  /** A cursor from an interrupted sync: the first source's sync continues after it. It is valid only with the filter it was issued under. */
  readonly after?: string;
  /** Narrows and orders what each scope lists, on the source's side. */
  readonly filter?: SyncFilter;
}

/** The short direction names the command line takes for an order's direction. */
export const directionNames = {
  asc: "ascending",
  desc: "descending",
} as const satisfies Readonly<Record<string, OrderDirection>>;

/** Where a sync a source interrupted carries on, as data a host acts on; the command line renders it as the commands to run. */
export interface SyncInterruption {
  /** The request that continues the failing source: its scopes and the sync's filter, after the cursor of the last page read from it, or from the start when none was read. */
  readonly resume: SyncRequest;
  /** The scopes of the sources after the failing one, which were not read; sync them afresh, under the same filter, once `resume` has finished. */
  readonly remaining: readonly string[];
  /** Whether pages read before the failure were written to the model. */
  readonly saved: boolean;
}

/**
 * Thrown by `sync` when a source fails part way. Its exit status and message are the source's failure, classified as `failureOf` classifies it; its cause is the error underneath that failure, such as the token port's own error; and what to run next is data, in `resume` and `remaining`, never text.
 */
export class SyncInterruptedError extends CliError implements SyncInterruption {
  readonly resume: SyncRequest;

  readonly remaining: readonly string[];

  readonly saved: boolean;

  /**
   * @param exitCode - The exit status the source's failure maps to.
   * @param message - The source's failure.
   * @param interruption - Where the sync carries on.
   * @param options - The underlying error, kept as the cause.
   */
  constructor(
    exitCode: CliError["exitCode"],
    message: string,
    interruption: SyncInterruption,
    options?: ErrorOptions,
  ) {
    super(exitCode, message, options);
    this.name = "SyncInterruptedError";
    this.resume = interruption.resume;
    this.remaining = interruption.remaining;
    this.saved = interruption.saved;
  }
}

/** What a sync wrote. */
export interface SyncResult {
  readonly modelId: string;
  /** The revision the last write took. */
  readonly revision: number;
  /** The participants, activities, transitions and relations written, each counted once. */
  readonly participants: number;
  readonly activities: number;
  readonly transitions: number;
  readonly relations: number;
  /** The parts of the scope the sources could not read, in the order they were met. */
  readonly gaps: readonly Gap[];
}

/** A usage error for a scope that names no source or a source nothing reads, or nothing for any other error. */
const usageError = (error: unknown): CliError | undefined => {
  if (error instanceof InvalidScopeError) {
    return new CliError(exitCodes.usage, error.message, { cause: error });
  }
  if (error instanceof UnknownSourceError) {
    return new CliError(
      exitCodes.usage,
      `no source reads "${error.prefix}" scopes`,
      { cause: error },
    );
  }

  return undefined;
};

/**
 * Reads every page of the scopes from their sources and merges each into the session's model as it is read, creating the model when the store has none: participants, bound activities, transitions, relations (sub-issues, assignees, repository membership) and run state. Records already in the model are replaced by identifier and the rest are kept, so syncing again refreshes what changed.
 *
 * When a source fails part way, the pages read before the failure are already written, and the error carries where to carry on: the request that resumes the failing source after the cursor of its last page read, and the scopes of the sources not reached.
 * @param session - The store and model.
 * @param sources - The source for each identifier prefix.
 * @param request - The scopes, a cursor to resume after, and a filter.
 * @returns What was written, and the gaps the sources reported.
 * @throws CliError with `usage` for a scope with no source prefix, a prefix no source serves, or `after` with scopes of more than one source; and SyncInterruptedError, with the source's failure and where to carry on, when a source fails part way.
 */
export const sync = async (
  session: GraphSession,
  sources: SourceLookup,
  request: SyncRequest,
): Promise<SyncResult> => {
  const { scopes, after, filter } = request;
  let groups: readonly SourceScopes[];
  try {
    groups = scopesBySource(scopes);
  } catch (error) {
    throw usageError(error) ?? error;
  }
  const [first] = groups;
  if (after !== undefined && groups.length > 1) {
    throw new CliError(
      exitCodes.usage,
      "--after resumes one source's sync: give only that source's scopes",
    );
  }
  const resume: SyncCheckpoint | undefined =
    after === undefined || first === undefined
      ? undefined
      : {
          modelId: session.modelId,
          scopes,
          ...(filter === undefined ? {} : { filter }),
          source: first.prefix,
          after,
        };

  try {
    const result = await syncScopes({
      store: session.store,
      sources,
      modelId: session.modelId,
      scopes,
      filter,
      resume,
      signal: session.signal,
    });

    return {
      modelId: session.modelId,
      revision: result.revision,
      participants: result.participants,
      activities: result.activities,
      transitions: result.transitions,
      relations: result.relations,
      gaps: result.gaps,
    };
  } catch (error) {
    const usage = usageError(error);
    if (usage !== undefined) {
      throw usage;
    }
    if (!(error instanceof InterruptedSyncError)) {
      throw error;
    }
    const failure = failureOf(error.cause);
    const { resume: from, remaining, saved } = error;
    const failing = groups.find((group) => group.prefix === from.source);
    if (failing === undefined) {
      throw new Error(
        `unreachable: the interrupted source "${from.source}" is one of the sync's own`,
        { cause: error },
      );
    }
    throw new SyncInterruptedError(
      failure.exitCode,
      failure.message,
      {
        resume: {
          scopes: failing.scopes,
          ...(from.after === undefined ? {} : { after: from.after }),
          ...(filter === undefined ? {} : { filter }),
        },
        remaining,
        saved,
      },
      { cause: underlyingCause(error.cause) },
    );
  }
};
