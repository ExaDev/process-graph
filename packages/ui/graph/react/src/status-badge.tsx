import type { Status } from "@exadev/process-graph-domain";
import type { ReactElement } from "react";
import { statusLabels } from "./labels.ts";

export interface StatusBadgeProps {
  readonly status: Status;
  readonly className?: string | undefined;
}

/**
 * A status as text, carrying the status in `data-status` so a stylesheet can colour it.
 * @param props - The status and an optional class.
 * @returns A `span` naming the status.
 */
export const StatusBadge = (props: StatusBadgeProps): ReactElement => {
  const { status, className } = props;

  return (
    <span className={className} data-status={status}>
      {statusLabels[status]}
    </span>
  );
};
