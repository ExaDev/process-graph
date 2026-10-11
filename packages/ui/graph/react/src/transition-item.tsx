import type { ReactElement } from "react";

/** The parts of a transition item a class can be given to. */
export type TransitionItemPart = "root" | "from" | "to" | "label";

export interface TransitionItemProps {
  /** The transition, or for an edge standing for several, the first. */
  readonly id: string;
  /** The source element's display label. */
  readonly from: string;
  /** The target element's display label. */
  readonly to: string;
  /** The guard or message label, when there is one. */
  readonly label?: string | undefined;
  /** Whether the transition passes work between actors. */
  readonly handoff?: boolean | undefined;
  /** Whether both ends are on the critical path. */
  readonly critical?: boolean | undefined;
  readonly classNames?: Partial<Record<TransitionItemPart, string>> | undefined;
}

/**
 * One transition as a list item: where it comes from, where it goes and its label. The item carries `data-transition-id` and, as applicable, `data-handoff` and `data-critical`; a hand-off says so in its text.
 * @param props - The transition's ends and label.
 * @returns An `li`, to place in a list.
 */
export const TransitionItem = (props: TransitionItemProps): ReactElement => {
  const {
    id,
    from,
    to,
    label,
    handoff = false,
    critical = false,
    classNames = {},
  } = props;

  return (
    <li
      className={classNames.root}
      data-transition-id={id}
      data-handoff={handoff ? "" : undefined}
      data-critical={critical ? "" : undefined}
    >
      <span className={classNames.from} data-part="from">
        {from}
      </span>{" "}
      to{" "}
      <span className={classNames.to} data-part="to">
        {to}
      </span>
      {label === undefined ? null : (
        <span className={classNames.label} data-part="label">
          {" "}
          ({label})
        </span>
      )}
      {handoff ? " (hand-off)" : null}
    </li>
  );
};
