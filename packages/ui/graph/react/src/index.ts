/**
 * Headless React hooks and unstyled components over the process model. The hooks load and follow a model from a `GraphStore` client, derive statuses, the ready set, blocked chains, impact, explanations and the critical path from `@exadev/process-graph-domain`, project views with `@exadev/process-graph-projection`, and hold selection and filter state. The components render semantic markup with ARIA roles and stable `data-*` hooks, and take class names for their parts; they carry no styles.
 */
export { noFacts, type Run } from "./run.ts";
export { useModel, type ModelClient, type ModelState } from "./model.ts";
export {
  stepWeight,
  useBlockedChain,
  useBlockers,
  useCriticalPath,
  useImpact,
  useReadySet,
  useStatuses,
  useWhyStatus,
  type BlockedChain,
} from "./analysis.ts";
export {
  project,
  useProjection,
  type ProjectedView,
  type ViewsByNotation,
} from "./projection.ts";
export {
  actorsOf,
  emptyFilter,
  filterElements,
  filterOptions,
  matchesFilter,
  sourceScope,
  useElementFilter,
  type ElementFilter,
  type ElementFilterState,
  type FilterOption,
  type FilterOptions,
} from "./filter.ts";
export {
  useGraphSelection,
  type GraphSelection,
  type GraphSelectionOptions,
  type SelectionContainerProps,
  type SelectionItemProps,
} from "./selection.ts";
export { elementLabel, ruleDescriptions, statusLabels } from "./labels.ts";
export { StatusBadge, type StatusBadgeProps } from "./status-badge.tsx";
export {
  ElementCard,
  type ElementCardPart,
  type ElementCardProps,
  type NamedElement,
} from "./element-card.tsx";
export {
  TransitionItem,
  type TransitionItemPart,
  type TransitionItemProps,
} from "./transition-item.tsx";
export { Lane, type LanePart, type LaneProps } from "./lane.tsx";
export { Legend, type LegendPart, type LegendProps } from "./legend.tsx";
export {
  FilterPanel,
  type FilterPanelPart,
  type FilterPanelProps,
} from "./filter-panel.tsx";
export {
  DetailPanel,
  type DetailPanelPart,
  type DetailPanelProps,
} from "./detail-panel.tsx";
