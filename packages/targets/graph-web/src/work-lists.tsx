import type { Status } from "@exadev/process-graph-domain";
import { handoffs } from "@exadev/process-graph-projection";
import {
  matchesFilter,
  useBlockers,
  useCriticalPath,
  useGraphSelection,
  useReadySet,
  type ElementFilter,
  type Run,
} from "@exadev/process-graph-react";
import {
  validate,
  validateOverlay,
  type OpenIds,
} from "@exadev/process-graph-schema";
import { StatusBadge, visuallyHidden } from "@exadev/process-graph-ui";
import { useId, useMemo, type ReactElement, type ReactNode } from "react";
import { list, listbox, muted, option, section } from "./app.css.ts";
import { Tabs } from "./tabs.tsx";
import { listTabs, type ListTab } from "./url-state.ts";

/** Each list's tab label. */
export const listLabels: Readonly<Record<ListTab, string>> = {
  ready: "Ready",
  blocked: "Blocked",
  path: "Critical path",
  handoffs: "Hand-offs",
  cycles: "Cycles",
  issues: "Problems",
};

/** What every list reads: the run, each element's status and label, the filter, and the shared selection. */
export interface ListContext {
  readonly run: Run<OpenIds>;
  readonly statuses: ReadonlyMap<string, Status>;
  readonly labelOf: (id: string) => string;
  readonly filter: ElementFilter;
  readonly selected: string | undefined;
  readonly onSelect: (id: string | undefined) => void;
}

interface ElementListProps extends ListContext {
  readonly label: string;
  readonly ids: readonly string[];
  /** What to say when the list is empty. */
  readonly empty: string;
  /** Extra text after an element's label, such as what it waits on. */
  readonly detail?: ((id: string) => ReactNode) | undefined;
}

/** A keyboard-navigable list of elements that shares the app's selection: the arrow keys, Home, End and Escape move it, as on the canvas. */
const ElementList = (props: ElementListProps): ReactElement => {
  const { label, ids, empty, detail, statuses, labelOf, selected, onSelect } =
    props;
  const selection = useGraphSelection(ids, { selected, onChange: onSelect });
  if (ids.length === 0) {
    return <p className={muted}>{empty}</p>;
  }

  return (
    <ul aria-label={label} className={listbox} {...selection.containerProps}>
      {ids.map((id) => {
        const status = statuses.get(id);

        return (
          <li
            key={id}
            className={option}
            data-element-id={id}
            {...selection.itemProps(id)}
          >
            {labelOf(id)}{" "}
            {status === undefined ? null : <StatusBadge status={status} />}
            {detail === undefined ? null : <> {detail(id)}</>}
          </li>
        );
      })}
    </ul>
  );
};

/** The elements of `ids` the filter shows, in their given order. */
const useShown = (context: ListContext, ids: readonly string[]) => {
  const { run, statuses, filter } = context;

  return useMemo(() => {
    const elements = new Map(
      run.model.elements.map((element) => [element.id, element]),
    );

    return ids.filter((id) => {
      const element = elements.get(id);
      const status = statuses.get(id);

      return (
        element !== undefined &&
        status !== undefined &&
        matchesFilter(element, status, filter)
      );
    });
  }, [run.model, statuses, filter, ids]);
};

const ReadyList = (context: ListContext): ReactElement => {
  const ready = useReadySet(context.run);
  const shown = useShown(context, ready);

  return (
    <ElementList
      {...context}
      label="Ready to start"
      ids={shown}
      empty="Nothing shown is ready to start."
    />
  );
};

const BlockedList = (context: ListContext): ReactElement => {
  const blockers = useBlockers(context.run);
  const blocked = useMemo(() => [...blockers.keys()], [blockers]);
  const shown = useShown(context, blocked);

  return (
    <ElementList
      {...context}
      label="Blocked"
      ids={shown}
      empty="Nothing shown is blocked."
      detail={(id) => {
        const waiting = blockers.get(id);

        return waiting === undefined
          ? null
          : `waits on ${waiting.map(context.labelOf).join(", ")}`;
      }}
    />
  );
};

const PathList = (context: ListContext): ReactElement => {
  const { path } = useCriticalPath(context.run);

  return (
    <ElementList
      {...context}
      label="Critical path"
      ids={path}
      empty="No work is left, so there is no critical path."
    />
  );
};

const HandoffList = (context: ListContext): ReactElement => {
  const { run, labelOf } = context;
  const found = useMemo(() => handoffs(run.model), [run.model]);
  const participants = useMemo(
    () =>
      new Map(
        run.model.participants.map((participant) => [
          participant.id,
          participant.label,
        ]),
      ),
    [run.model],
  );
  const transitions = useMemo(
    () =>
      new Map(
        run.model.transitions.map((transition) => [transition.id, transition]),
      ),
    [run.model],
  );
  if (found.length === 0) {
    return <p className={muted}>No work passes from one owner to another.</p>;
  }

  return (
    <ul aria-label="Hand-offs" className={list}>
      {found.map((handoff) => {
        const transition = transitions.get(handoff.transition);

        return (
          <li key={handoff.transition} data-transition-id={handoff.transition}>
            {participants.get(handoff.from) ?? handoff.from} hands over to{" "}
            {participants.get(handoff.to) ?? handoff.to}
            {transition === undefined
              ? null
              : `: ${labelOf(transition.source)} before ${labelOf(transition.target)}`}
          </li>
        );
      })}
    </ul>
  );
};

const ProblemList = (context: ListContext): ReactElement => {
  const { run } = context;
  const problems = useMemo(
    () => [...validate(run.model), ...validateOverlay(run.model, run.overlay)],
    [run],
  );
  if (problems.length === 0) {
    return (
      <p className={muted}>
        The model and its run state are valid: every reference resolves and no
        identifier repeats.
      </p>
    );
  }

  return (
    <ul aria-label="Problems" className={list}>
      {problems.map((problem) => (
        <li
          key={`${problem.code} ${problem.message}`}
          data-issue={problem.code}
        >
          {problem.message}
        </li>
      ))}
    </ul>
  );
};

/** The cycles list of a model whose statuses could be derived, which therefore has no illegal cycle; a model with one never reaches the lists. */
const NoCycles = (): ReactElement => (
  <p className={muted}>
    No cycle runs without a decision to leave it, so every element&apos;s status
    can be decided.
  </p>
);

const panels: Readonly<
  Record<ListTab, (context: ListContext) => ReactElement>
> = {
  ready: ReadyList,
  blocked: BlockedList,
  path: PathList,
  handoffs: HandoffList,
  cycles: NoCycles,
  issues: ProblemList,
};

export interface WorkListsProps extends ListContext {
  readonly tab: ListTab;
  readonly onTab: (tab: ListTab) => void;
}

/**
 * The questions the command line answers about the whole model, as lists beside the view: what is ready, what is blocked and on what, the critical path, the hand-offs between owners, cycles and structural problems. Element lists follow the filter and share the app's selection.
 * @param props - The run, statuses, labels, filter, selection and the open list.
 * @returns The tabbed lists.
 */
export const WorkLists = (props: WorkListsProps): ReactElement => {
  const { tab, onTab, ...context } = props;
  const panelId = useId();
  const headingId = useId();
  const Panel = panels[tab];

  return (
    <section
      aria-labelledby={headingId}
      className={section}
      data-screen="lists"
    >
      <h2 id={headingId} className={visuallyHidden}>
        Work
      </h2>
      <Tabs
        label="Work"
        options={listTabs.map((value) => ({ value, label: listLabels[value] }))}
        selected={tab}
        onSelect={onTab}
        panelId={panelId}
      />
      <div
        id={panelId}
        role="tabpanel"
        aria-label={listLabels[tab]}
        data-list={tab}
      >
        <Panel {...context} />
      </div>
    </section>
  );
};
