import type { Gap } from "@exadev/process-graph-source-contract";
import type { ReactElement } from "react";
import { button, list, notice } from "./app.css.ts";
import type { Failure } from "./failure.ts";

/**
 * Says the page is offline: the last sync is still shown from this device, and syncing waits for the network.
 * @returns The notice, a status region so a screen reader announces it.
 */
export const OfflineNotice = (): ReactElement => (
  <p role="status" className={notice.warning} data-notice="offline">
    You are offline. The last sync on this device is shown; syncing resumes when
    you are back online.
  </p>
);

/**
 * Says this copy of the app keeps nothing between visits, because the origin it is served from is shared with other sites. It has no dismiss control: what it says holds for the whole visit.
 * @returns The notice.
 */
export const EphemeralNotice = (): ReactElement => (
  <p role="status" className={notice.warning} data-notice="ephemeral">
    This copy keeps nothing between visits: its address is shared with other
    sites, which could read anything it saved. The token, the synced issues and
    your settings are held in memory and are gone when you close or reload the
    page. Installing the app and using it offline need an address of its own,
    for example running it locally from the repository.
  </p>
);

export interface UpdateNoticeProps {
  readonly onReload: () => void;
}

/**
 * Offers a new version of the app. It is never applied on its own, so a running sync is not cut short.
 * @param props - What to do when the person chooses to reload.
 * @returns The notice.
 */
export const UpdateNotice = (props: UpdateNoticeProps): ReactElement => (
  <div role="status" className={notice.info} data-notice="update">
    <span>A new version of the app is ready.</span>
    <button type="button" className={button} onClick={props.onReload}>
      Reload to update
    </button>
  </div>
);

export interface LinkProblemsProps {
  readonly problems: readonly string[];
}

/**
 * Lists the parts of the page address the app could not use and left out.
 * @param props - One sentence per problem.
 * @returns The notice, or nothing when the address was understood.
 */
export const LinkProblems = (props: LinkProblemsProps): ReactElement | null =>
  props.problems.length === 0 ? null : (
    <div role="alert" className={notice.warning} data-notice="link">
      <span>Some of this link could not be used:</span>
      <ul className={list}>
        {props.problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );

export interface FailureNoticeProps {
  readonly failure: Failure;
  /** Formats an instant for display, such as a rate limit's reset. */
  readonly formatTime: (iso: string) => string;
  /** Offered when the failure is the token's: opens the token settings. */
  readonly onChangeToken: () => void;
}

/**
 * Explains why a sync stopped. A rate limit says when it resets; a rejected token offers to change it; anything else is shown by its message. What was read before the failure is kept, which the notice says.
 * @param props - The failure, a time formatter and the token action.
 * @returns The notice.
 */
export const FailureNotice = (props: FailureNoticeProps): ReactElement => {
  const { failure, formatTime, onChangeToken } = props;
  const kept = "What was read before it stopped is kept.";

  if (failure.kind === "rate-limited") {
    return (
      <p role="alert" className={notice.error} data-notice="rate-limited">
        GitHub is rate limiting requests
        {failure.resetAt === undefined
          ? "; try again later."
          : `; the limit resets at ${formatTime(failure.resetAt)}.`}{" "}
        {kept} Resume the sync then.
      </p>
    );
  }
  if (failure.kind === "unauthorised") {
    return (
      <div role="alert" className={notice.error} data-notice="unauthorised">
        <span>
          GitHub did not accept the token. It may have expired, been revoked or
          lack access to these repositories. {kept}
        </span>
        <button type="button" className={button} onClick={onChangeToken}>
          Change the token
        </button>
      </div>
    );
  }

  return (
    <p role="alert" className={notice.error} data-notice={failure.kind}>
      The sync stopped: {failure.message} {kept}
    </p>
  );
};

export interface GapsNoticeProps {
  readonly gaps: readonly Gap[];
}

const gapReasons: Readonly<Record<Gap["reason"], string>> = {
  "not-found": "not found",
  forbidden: "not visible to this token",
};

/**
 * Lists the parts of the scope the last sync could not read, so a partial model is never mistaken for a whole one.
 * @param props - The gaps, in the order met.
 * @returns The notice, or nothing when every part was read.
 */
export const GapsNotice = (props: GapsNoticeProps): ReactElement | null =>
  props.gaps.length === 0 ? null : (
    <div role="status" className={notice.warning} data-notice="gaps">
      <span>Part of the scope could not be read, so the graph is partial:</span>
      <ul className={list}>
        {props.gaps.map((gap) => (
          <li key={`${gap.target} ${gap.reason}`} data-gap={gap.target}>
            {gap.target}: {gapReasons[gap.reason]}. {gap.message}
          </li>
        ))}
      </ul>
    </div>
  );
