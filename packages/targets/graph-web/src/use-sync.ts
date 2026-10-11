import type { Gap } from "@exadev/process-graph-source-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { failureOf, type Failure } from "./failure.ts";
import type { AppPorts } from "./ports.ts";
import type { SyncCheckpoint, SyncRecord } from "./sync-record.ts";
import { runSync, type SyncProgress } from "./sync.ts";

/** Where the sync of the shown model stands in this page. */
export type SyncState =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly progress: SyncProgress | undefined }
  | { readonly phase: "finished"; readonly progress: SyncProgress }
  | { readonly phase: "cancelled"; readonly progress: SyncProgress | undefined }
  | {
      readonly phase: "failed";
      readonly failure: Failure;
      readonly progress: SyncProgress | undefined;
    };

/** The sync of one model, and what can be done with it. */
export interface SyncHandle {
  readonly state: SyncState;
  /** This model's last sync record on the device: where an interrupted sync stopped, and what the sources could not read. */
  readonly record: SyncRecord | undefined;
  /** Reads every scope from the start. */
  readonly start: () => void;
  /** Carries on from where the last sync stopped. */
  readonly resume: () => void;
  /** Stops the running sync; what it has written stays written. */
  readonly cancel: () => void;
}

const idle: SyncState = { phase: "idle" };

/**
 * Runs and follows the sync of one model from its scopes. Progress is recorded on the device after every page, so a sync interrupted by a cancel, a rate limit, a closed tab or a reload can be resumed from its checkpoint. Changing the model or unmounting cancels a running sync.
 * @param ports - The app's ports: the store, the sources, the token and the sync records. The token is read when a sync starts and handed straight to the sources, so it never enters React state.
 * @param modelId - The model the scopes sync into.
 * @param scopes - The scopes, in order.
 * @returns The sync's state, its record and its controls.
 */
export const useSync = (
  ports: AppPorts,
  modelId: string,
  scopes: readonly string[],
): SyncHandle => {
  const [state, setState] = useState<{
    readonly modelId: string;
    readonly value: SyncState;
  }>({ modelId, value: idle });
  const [record, setRecord] = useState<SyncRecord | undefined>(() =>
    ports.syncRecords.read(modelId),
  );
  const [recordFor, setRecordFor] = useState(modelId);
  const controller = useRef<AbortController | undefined>(undefined);

  if (recordFor !== modelId) {
    setRecordFor(modelId);
    setRecord(ports.syncRecords.read(modelId));
  }

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [modelId],
  );

  const run = useCallback(
    (resume: SyncCheckpoint | undefined, earlierGaps: readonly Gap[]) => {
      const token = ports.token.read();
      if (token === undefined) {
        return;
      }
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      const settle = (value: SyncState): void => {
        if (controller.current === current) {
          setState({ modelId, value });
        }
      };
      const remember = (next: SyncRecord): void => {
        ports.syncRecords.write(next);
        if (controller.current === current) {
          setRecord(next);
        }
      };
      let latest: SyncProgress | undefined;
      const withEarlierGaps = (progress: SyncProgress): SyncProgress => ({
        ...progress,
        gaps: [...earlierGaps, ...progress.gaps],
      });
      settle({ phase: "running", progress: undefined });
      runSync({
        store: ports.store,
        sources: ports.sources(token),
        modelId,
        scopes,
        resume,
        signal: current.signal,
        onProgress: (progress) => {
          latest = withEarlierGaps(progress);
          remember({
            modelId,
            gaps: latest.gaps,
            ...(latest.checkpoint === undefined
              ? {}
              : { checkpoint: latest.checkpoint }),
          });
          settle({ phase: "running", progress: latest });
        },
      }).then(
        (progress) => {
          const finished = withEarlierGaps(progress);
          remember({ modelId, gaps: finished.gaps });
          settle({ phase: "finished", progress: finished });
        },
        (error: unknown) => {
          settle(
            current.signal.aborted
              ? { phase: "cancelled", progress: latest }
              : {
                  phase: "failed",
                  failure: failureOf(error),
                  progress: latest,
                },
          );
        },
      );
    },
    [ports, modelId, scopes],
  );

  const start = useCallback(() => {
    run(undefined, []);
  }, [run]);
  const resume = useCallback(() => {
    run(record?.checkpoint, record?.gaps ?? []);
  }, [run, record]);
  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  return {
    state: state.modelId === modelId ? state.value : idle,
    record,
    start,
    resume,
    cancel,
  };
};
