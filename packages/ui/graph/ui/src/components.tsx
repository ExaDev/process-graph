import type { Status } from "@exadev/process-graph-domain";
import {
  DetailPanel as HeadlessDetailPanel,
  ElementCard as HeadlessElementCard,
  FilterPanel as HeadlessFilterPanel,
  Lane as HeadlessLane,
  Legend as HeadlessLegend,
  StatusBadge as HeadlessStatusBadge,
  TransitionItem as HeadlessTransitionItem,
  type DetailPanelProps,
  type ElementCardProps,
  type FilterPanelProps,
  type LaneProps,
  type LegendProps,
  type TransitionItemProps,
} from "@exadev/process-graph-react";
import type { IdSpace } from "@exadev/process-graph-schema";
import type { ReactElement, ReactNode } from "react";
import { surfaceRoot } from "./base.css.ts";
import {
  badge,
  blockersNote,
  button,
  card,
  cardLabel,
  checkbox,
  criticalMarker,
  detailHeading,
  detailList,
  detailPanel,
  detailReason,
  detailSectionHeading,
  filterGroup,
  filterLegend,
  filterOption,
  filterPanel,
  lane,
  laneBody,
  laneHeading,
  legend,
  legendItem,
  swatch,
  transition,
  transitionEnd,
} from "./components.css.ts";
import { darkTheme, lightTheme } from "./theme.css.ts";

/** The themes this package ships. */
export type ThemeName = "light" | "dark";

/** The class that assigns each shipped theme. */
export const themes: Readonly<Record<ThemeName, string>> = {
  light: lightTheme,
  dark: darkTheme,
};

export interface GraphThemeProps {
  readonly theme: ThemeName;
  readonly children?: ReactNode;
}

/**
 * Applies a theme to everything inside it: assigns the theme contract's values and sets the page colours and type the components inherit. A consumer with its own theme puts its own `createTheme` class and `surfaceRoot` on an element instead.
 * @param props - The theme and its content.
 * @returns A `div` carrying the theme class and `data-theme`.
 */
export const GraphTheme = (props: GraphThemeProps): ReactElement => {
  const { theme, children } = props;

  return (
    <div className={`${themes[theme]} ${surfaceRoot}`} data-theme={theme}>
      {children}
    </div>
  );
};

export interface StatusBadgeProps {
  readonly status: Status;
}

/**
 * A status badge in the status's colour.
 * @param props - The status.
 * @returns The badge.
 */
export const StatusBadge = (props: StatusBadgeProps): ReactElement => {
  const { status } = props;

  return <HeadlessStatusBadge status={status} className={badge({ status })} />;
};

/**
 * An element card with its status colour, its kind's shape, the critical path ring and the selection outline.
 * @param props - As for the headless `ElementCard`, without class names.
 * @returns The card.
 */
export const ElementCard = <I extends IdSpace>(
  props: Omit<ElementCardProps<I>, "classNames">,
): ReactElement => {
  const { element, status, critical = false } = props;

  return (
    <HeadlessElementCard
      {...props}
      classNames={{
        root: card({ status, kind: element.kind, critical }),
        label: cardLabel,
        status: badge({ status }),
        critical: criticalMarker,
        blockers: blockersNote,
      }}
    />
  );
};

/**
 * A transition, coloured as a hand-off or on the critical path.
 * @param props - As for the headless `TransitionItem`, without class names.
 * @returns An `li`.
 */
export const TransitionItem = (
  props: Omit<TransitionItemProps, "classNames">,
): ReactElement => (
  <HeadlessTransitionItem
    {...props}
    classNames={{ root: transition, from: transitionEnd, to: transitionEnd }}
  />
);

/**
 * A bordered swimlane with a small heading.
 * @param props - As for the headless `Lane`, without class names.
 * @returns The lane.
 */
export const Lane = (props: Omit<LaneProps, "classNames">): ReactElement => (
  <HeadlessLane
    {...props}
    classNames={{ root: lane, heading: laneHeading, body: laneBody }}
  />
);

/**
 * A legend with a coloured swatch per status.
 * @param props - As for the headless `Legend`, without class names.
 * @returns The legend.
 */
export const Legend = (
  props: Omit<LegendProps, "classNames">,
): ReactElement => (
  <HeadlessLegend
    {...props}
    classNames={{ root: legend, item: legendItem, swatch }}
  />
);

/**
 * A filter panel of bordered checkbox groups.
 * @param props - As for the headless `FilterPanel`, without class names.
 * @returns The form.
 */
export const FilterPanel = (
  props: Omit<FilterPanelProps, "classNames">,
): ReactElement => (
  <HeadlessFilterPanel
    {...props}
    classNames={{
      root: filterPanel,
      group: filterGroup,
      legend: filterLegend,
      option: filterOption,
      checkbox,
      clear: button,
    }}
  />
);

/**
 * A detail panel on a raised surface.
 * @param props - As for the headless `DetailPanel`, without class names.
 * @returns The panel.
 */
export const DetailPanel = <I extends IdSpace>(
  props: Omit<DetailPanelProps<I>, "classNames">,
): ReactElement => {
  const { explanation } = props;

  return (
    <HeadlessDetailPanel
      {...props}
      classNames={{
        root: detailPanel,
        heading: detailHeading,
        status: badge({ status: explanation.status }),
        reason: detailReason,
        sectionHeading: detailSectionHeading,
        list: detailList,
      }}
    />
  );
};
