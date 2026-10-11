import type { Overlay } from "@exadev/process-graph-schema";
import type { ReactElement } from "react";
import {
  useBlockedChain,
  useBlockers,
  useCriticalPath,
  useImpact,
  useStatuses,
  useWhyStatus,
} from "../analysis.ts";
import { DetailPanel } from "../detail-panel.tsx";
import { ElementCard } from "../element-card.tsx";
import { FilterPanel } from "../filter-panel.tsx";
import { filterElements, filterOptions, useElementFilter } from "../filter.ts";
import { elementLabel } from "../labels.ts";
import { Lane } from "../lane.tsx";
import { Legend } from "../legend.tsx";
import { useProjection } from "../projection.ts";
import { noFacts } from "../run.ts";
import { useGraphSelection } from "../selection.ts";
import { TransitionItem } from "../transition-item.tsx";
import type { OrderIds } from "./ids.ts";
import { order } from "./order.ts";

type OrderId = OrderIds["element"];

const elementOf = (id: OrderId) => {
  const element = order.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new Error(`no element ${id}`);
  }

  return element;
};

const labelOf = (id: OrderId): string => elementLabel(elementOf(id));

const transitionOf = (id: OrderIds["transition"]) => {
  const transition = order.transitions.find((candidate) => candidate.id === id);
  if (transition === undefined) {
    throw new Error(`no transition ${id}`);
  }

  return transition;
};

/** The order model's declared swimlane projection. */
const swimlane = { id: "p-lanes", notation: "swimlane" } as const;

interface BoardProps {
  readonly overlay: Overlay<OrderIds>;
}

/**
 * A consumer of every hook and component, as an application would write one: the order process as swimlanes of element cards, its hand-offs as a list, a filter panel, a legend and the selected element's details.
 * @param props - The run overlay.
 * @returns The board.
 */
export const Board = (props: BoardProps): ReactElement => {
  const { overlay } = props;
  const run = { model: order, overlay, facts: noFacts };
  const statuses = useStatuses(run);
  const blockers = useBlockers(run);
  const critical = new Set(useCriticalPath(run).path);
  const { filter, toggleStatus, toggleActor, toggleSource, clear } =
    useElementFilter();
  const shown = filterElements(order, statuses, filter);
  const projected = useProjection(order, swimlane);
  if (projected.notation !== "swimlane") {
    throw new Error("expected a swimlane");
  }
  const { lanes, unassigned, handoffs } = projected.view;
  // The keys move through the cards in the order they are drawn: lane by lane, then the elements no lane holds.
  const drawn = [...lanes.flatMap((lane) => lane.nodes), ...unassigned].filter(
    (id) => shown.includes(id),
  );
  const selection = useGraphSelection(drawn);
  const explanation = useWhyStatus(run, selection.selected);
  const chain = useBlockedChain(run, selection.selected);
  const impacted = useImpact(run, selection.selected);

  const card = (id: OrderId): ReactElement | null => {
    const status = statuses.get(id);

    return status === undefined || !shown.includes(id) ? null : (
      <ElementCard
        key={id}
        element={elementOf(id)}
        status={status}
        critical={critical.has(id)}
        blockedBy={blockers.get(id)?.map((blocker) => ({
          id: blocker,
          label: labelOf(blocker),
        }))}
        item={selection.itemProps(id)}
      />
    );
  };

  return (
    <main>
      <FilterPanel
        filter={filter}
        options={filterOptions(order)}
        onToggleStatus={toggleStatus}
        onToggleActor={toggleActor}
        onToggleSource={toggleSource}
        onClear={clear}
      />
      <Legend critical />
      <div aria-label="Order process" {...selection.containerProps}>
        {lanes.map((lane) => (
          <Lane
            key={lane.participant}
            participant={lane.participant}
            label={lane.label}
          >
            {lane.nodes.map(card)}
          </Lane>
        ))}
        <div role="group" aria-label="Unassigned">
          {unassigned.map(card)}
        </div>
      </div>
      <ul aria-label="Hand-offs">
        {handoffs.map((handoff) => {
          const transition = transitionOf(handoff.transition);

          return (
            <TransitionItem
              key={handoff.transition}
              id={handoff.transition}
              from={labelOf(transition.source)}
              to={labelOf(transition.target)}
              label={transition.guard}
              handoff
            />
          );
        })}
      </ul>
      {selection.selected === undefined || explanation === undefined ? null : (
        <DetailPanel
          element={elementOf(selection.selected)}
          explanation={explanation}
          blockers={chain.blockers}
          impact={impacted}
          labelOf={labelOf}
        />
      )}
    </main>
  );
};
