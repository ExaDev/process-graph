import { statuses, type Status } from "@exadev/process-graph-domain";
import type { ReactElement } from "react";
import { statusLabels } from "./labels.ts";

/** The parts of a legend a class can be given to. */
export type LegendPart = "root" | "item" | "swatch" | "label";

export interface LegendProps {
  /** The statuses to explain. Defaults to every status. */
  readonly statuses?: readonly Status[] | undefined;
  /** Whether to explain the critical path marking too. */
  readonly critical?: boolean | undefined;
  readonly classNames?: Partial<Record<LegendPart, string>> | undefined;
}

/**
 * A key to the statuses a view colours: a labelled list with a swatch per status. Each item and its swatch carry `data-status`, or `data-critical` for the critical path entry, so a stylesheet colours the swatch by attribute.
 * @param props - The statuses to list and the classes to give its parts.
 * @returns The legend.
 */
export const Legend = (props: LegendProps): ReactElement => {
  const {
    statuses: shown = statuses,
    critical = false,
    classNames = {},
  } = props;

  return (
    <ul aria-label="Legend" className={classNames.root}>
      {shown.map((status) => (
        <li key={status} className={classNames.item} data-status={status}>
          <span
            aria-hidden="true"
            className={classNames.swatch}
            data-part="swatch"
            data-status={status}
          />
          <span className={classNames.label} data-part="label">
            {statusLabels[status]}
          </span>
        </li>
      ))}
      {critical ? (
        <li className={classNames.item} data-critical="">
          <span
            aria-hidden="true"
            className={classNames.swatch}
            data-part="swatch"
            data-critical=""
          />
          <span className={classNames.label} data-part="label">
            Critical path
          </span>
        </li>
      ) : null}
    </ul>
  );
};
