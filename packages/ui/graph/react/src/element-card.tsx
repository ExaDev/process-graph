import type { Status } from "@exadev/process-graph-domain";
import type { Element, IdSpace } from "@exadev/process-graph-schema";
import type { ReactElement } from "react";
import { elementLabel } from "./labels.ts";
import type { SelectionItemProps } from "./selection.ts";
import { StatusBadge } from "./status-badge.tsx";

/** The parts of an element card a class can be given to. */
export type ElementCardPart =
  "root" | "label" | "status" | "critical" | "blockers";

/** Another element named by a card, by id and display label. */
export interface NamedElement {
  readonly id: string;
  readonly label: string;
}

export interface ElementCardProps<I extends IdSpace> {
  readonly element: Element<I["element"], I>;
  readonly status: Status;
  /** Whether the element is on the critical path. */
  readonly critical?: boolean | undefined;
  /** The open work the element waits on, shown when it is not empty. */
  readonly blockedBy?: readonly NamedElement[] | undefined;
  /** The props from `useGraphSelection().itemProps`, when the card is a navigable item. */
  readonly item?: SelectionItemProps | undefined;
  readonly classNames?: Partial<Record<ElementCardPart, string>> | undefined;
}

/**
 * One element: its label, its status, whether it is on the critical path, and what it is blocked by. The root carries `data-element-id`, `data-kind`, `data-status` and, on the critical path, `data-critical`.
 * @param props - The element, its status and what to show beside it.
 * @returns The card.
 */
export const ElementCard = <I extends IdSpace>(
  props: ElementCardProps<I>,
): ReactElement => {
  const {
    element,
    status,
    critical = false,
    blockedBy = [],
    item,
    classNames = {},
  } = props;

  return (
    <div
      {...item}
      className={classNames.root}
      data-element-id={element.id}
      data-kind={element.kind}
      data-status={status}
      data-critical={critical ? "" : undefined}
    >
      <span className={classNames.label} data-part="label">
        {elementLabel(element)}
      </span>
      <StatusBadge status={status} className={classNames.status} />
      {critical ? (
        <span className={classNames.critical} data-part="critical">
          Critical path
        </span>
      ) : null}
      {blockedBy.length > 0 ? (
        <span className={classNames.blockers} data-part="blockers">
          Blocked by {blockedBy.map((blocker) => blocker.label).join(", ")}
        </span>
      ) : null}
    </div>
  );
};
