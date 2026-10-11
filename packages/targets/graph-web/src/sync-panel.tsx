import { useId, type ReactElement } from "react";
import {
  button,
  muted,
  primaryButton,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";
import type { SyncProgress } from "@exadev/process-graph-sync";
import type { SyncHandle } from "./use-sync.ts";

export interface SyncPanelProps {
  readonly sync: SyncHandle;
  /** Whether a token is saved; without one there is nothing to sync with. */
  readonly hasToken: boolean;
  readonly online: boolean;
}

const summary = (progress: SyncProgress): string =>
  `${String(progress.pages)} ${progress.pages === 1 ? "page" : "pages"} read: ${String(progress.activities)} ${progress.activities === 1 ? "issue" : "issues"} and ${String(progress.transitions)} ${progress.transitions === 1 ? "dependency" : "dependencies"} written.`;

/**
 * Starts, follows, cancels and resumes the sync of the shown scopes. Progress is announced as it is written; a sync that stopped part way offers to carry on from where it stopped.
 * @param props - The sync, whether a token is saved, and whether the page is online.
 * @returns The panel.
 */
export const SyncPanel = (props: SyncPanelProps): ReactElement => {
  const { sync, hasToken, online } = props;
  const { state, record } = sync;
  const headingId = useId();
  const running = state.phase === "running";
  const canSync = hasToken && online && !running;
  const resumable = !running && record?.checkpoint !== undefined;
  const progress = state.phase === "idle" ? undefined : state.progress;

  return (
    <section
      aria-labelledby={headingId}
      className={section}
      data-screen="sync"
      data-phase={state.phase}
    >
      <h2 id={headingId} className={sectionHeading}>
        Sync
      </h2>
      <div className={row}>
        <button
          type="button"
          className={primaryButton}
          disabled={!canSync}
          onClick={sync.start}
        >
          {state.phase === "idle" && record === undefined
            ? "Sync"
            : "Sync again"}
        </button>
        {resumable ? (
          <button
            type="button"
            className={button}
            disabled={!canSync}
            onClick={sync.resume}
          >
            Resume where it stopped
          </button>
        ) : null}
        {running ? (
          <button type="button" className={button} onClick={sync.cancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <p role="status" className={muted} data-progress>
        {running
          ? progress === undefined
            ? "Starting the sync..."
            : `Syncing. ${summary(progress)}`
          : state.phase === "finished"
            ? `Sync finished. ${summary(state.progress)}`
            : state.phase === "cancelled"
              ? `Sync cancelled.${progress === undefined ? "" : ` ${summary(progress)}`} Resume to carry on.`
              : resumable
                ? "The last sync stopped before it finished."
                : ""}
      </p>
      {hasToken ? null : <p className={muted}>Save a GitHub token to sync.</p>}
      {online ? null : <p className={muted}>Syncing needs the network.</p>}
    </section>
  );
};
