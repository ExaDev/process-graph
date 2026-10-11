import type { StatusExplanation } from "@exadev/process-graph-domain";
import type { Element, IdSpace } from "@exadev/process-graph-schema";
import { useId, type ReactElement } from "react";
import { elementLabel, ruleDescriptions } from "./labels.ts";
import { StatusBadge } from "./status-badge.tsx";

/** The parts of a detail panel a class can be given to. */
export type DetailPanelPart =
  | "root"
  | "heading"
  | "status"
  | "reason"
  | "section"
  | "sectionHeading"
  | "list";

export interface DetailPanelProps<I extends IdSpace> {
  readonly element: Element<I["element"], I>;
  /** Why the element has its status, from `useWhyStatus`. */
  readonly explanation: StatusExplanation<I>;
  /** The open work at the end of its blocked chain, from `useBlockedChain`. */
  readonly blockers: readonly I["element"][];
  /** The live work that depends on it, from `useImpact`. */
  readonly impact: readonly I["element"][];
  /** The display label of another element. */
  readonly labelOf: (id: I["element"]) => string;
  readonly classNames?: Partial<Record<DetailPanelPart, string>> | undefined;
}

interface SectionProps {
  readonly name: string;
  readonly heading: string;
  readonly items: readonly { readonly id: string; readonly label: string }[];
  readonly classNames: Partial<Record<DetailPanelPart, string>>;
}

const Section = ({
  name,
  heading,
  items,
  classNames,
}: SectionProps): ReactElement | null => {
  const id = useId();

  return items.length === 0 ? null : (
    <section
      aria-labelledby={id}
      className={classNames.section}
      data-section={name}
    >
      <h3 id={id} className={classNames.sectionHeading}>
        {heading}
      </h3>
      <ul className={classNames.list}>
        {items.map((item) => (
          <li key={item.id} data-element-id={item.id}>
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
};

/**
 * The details of one element: its status, the rule that decided it, what it is blocked by and what depends on it. The root is a complementary region named by the element's label; each list is a section carrying `data-section` with `blocked-by` or `impact`, shown only when it is not empty.
 * @param props - The element, its explanation, blockers and impact.
 * @returns The panel.
 */
export const DetailPanel = <I extends IdSpace>(
  props: DetailPanelProps<I>,
): ReactElement => {
  const {
    element,
    explanation,
    blockers,
    impact,
    labelOf,
    classNames = {},
  } = props;

  const heading = useId();
  const named = (ids: readonly I["element"][]) =>
    ids.map((id) => ({ id, label: labelOf(id) }));

  return (
    <aside
      aria-labelledby={heading}
      className={classNames.root}
      data-element-id={element.id}
      data-status={explanation.status}
    >
      <h2 id={heading} className={classNames.heading}>
        {elementLabel(element)}
      </h2>
      <StatusBadge status={explanation.status} className={classNames.status} />
      <p className={classNames.reason} data-rule={explanation.rule}>
        {ruleDescriptions[explanation.rule]}
      </p>
      <Section
        name="blocked-by"
        heading="Blocked by"
        items={named(blockers)}
        classNames={classNames}
      />
      <Section
        name="impact"
        heading="Impact"
        items={named(impact)}
        classNames={classNames}
      />
    </aside>
  );
};
