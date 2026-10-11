import { useId, type ReactElement, type ReactNode } from "react";

/** The parts of a lane a class can be given to. */
export type LanePart = "root" | "heading" | "body";

export interface LaneProps {
  /** The participant the lane belongs to. */
  readonly participant: string;
  readonly label: string;
  readonly children?: ReactNode;
  readonly classNames?: Partial<Record<LanePart, string>> | undefined;
}

/**
 * A swimlane: a group named by its heading, holding the work of one participant. The group carries `data-lane` with the participant's id.
 * @param props - The participant, its label and the lane's content.
 * @returns The lane.
 */
export const Lane = (props: LaneProps): ReactElement => {
  const { participant, label, children, classNames = {} } = props;

  const heading = useId();

  return (
    <div
      role="group"
      aria-labelledby={heading}
      className={classNames.root}
      data-lane={participant}
    >
      <h3 id={heading} className={classNames.heading} data-part="heading">
        {label}
      </h3>
      <div className={classNames.body} data-part="body">
        {children}
      </div>
    </div>
  );
};
