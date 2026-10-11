import { illegalCycles, type Status } from "@exadev/process-graph-domain";
import {
  elementLabel,
  emptyFilter,
  filterOptions,
  noFacts,
  useCriticalPath,
  useModel,
  useStatuses,
  type ElementFilter,
  type Run,
} from "@exadev/process-graph-react";
import { ProcessView } from "@exadev/process-graph-react-flow";
import type { OpenIds, OverlayStatus } from "@exadev/process-graph-schema";
import type { StoredModel } from "@exadev/process-graph-store-contract";
import { FilterPanel, Legend } from "@exadev/process-graph-ui";
import { useCallback, useId, useMemo, type ReactElement } from "react";
import { AddForm } from "./add-form.tsx";
import { withAddition, type Addition } from "./addition.ts";
import {
  canvas,
  list,
  muted,
  notice,
  section,
  sidebar,
  workspace,
} from "./app.css.ts";
import { ElementDetails } from "./element-details.tsx";
import { failureOf } from "./failure.ts";
import type { AppPorts } from "./ports.ts";
import { Tabs } from "./tabs.tsx";
import { viewKinds, type ViewKind, type ViewState } from "./url-state.ts";
import { ViewBoundary } from "./view-boundary.tsx";
import { resolveView } from "./views.ts";
import { WorkLists } from "./work-lists.tsx";

/** Each view's tab label. */
export const viewLabels: Readonly<Record<ViewKind, string>> = {
  flowchart: "Flowchart",
  swimlane: "Swimlane",
  state: "State machine",
  sequence: "Sequence",
};

export interface ModelAreaProps {
  readonly ports: AppPorts;
  readonly modelId: string;
  readonly state: ViewState;
  readonly update: (change: (state: ViewState) => ViewState) => void;
  /** The theme in use, for React Flow's own controls. */
  readonly colourScheme: "light" | "dark";
  /** Adds a scope and syncs it: expanding the model on demand to work it depends on outside the scope. */
  readonly onAddScope: (scope: string) => void;
}

interface LoadedModelProps extends ModelAreaProps {
  readonly stored: StoredModel;
}

interface CyclesNoticeProps {
  readonly cycles: readonly (readonly string[])[];
  readonly labelOf: (id: string) => string;
}

/** The illegal cycles of a model, as the command line's `cycles` lists them: work that waits on itself with no decision to leave the loop, so nothing in it can be ready. */
const CyclesNotice = (props: CyclesNoticeProps): ReactElement => (
  <section role="alert" className={notice.error} data-notice="cycles">
    <span>
      Some work waits on itself with no decision to leave the loop, so no status
      can be worked out until one of these dependencies is removed:
    </span>
    <ul className={list} aria-label="Cycles">
      {props.cycles.map((cycle) => (
        <li key={cycle.join(" ")}>
          {cycle.map(props.labelOf).join(" waits on ")}
        </li>
      ))}
    </ul>
  </section>
);

interface WorkspaceProps extends LoadedModelProps {
  readonly run: Run<OpenIds>;
  readonly labelOf: (id: string) => string;
}

const toggled = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
  const next = new Set(set);
  if (!next.delete(value)) {
    next.add(value);
  }

  return next;
};

/** The view, its filters, the lists and the selected element's details, side by side on a wide screen. */
const Workspace = (props: WorkspaceProps): ReactElement => {
  const {
    ports,
    modelId,
    state,
    update,
    colourScheme,
    onAddScope,
    run,
    labelOf,
  } = props;
  const statuses = useStatuses(run);
  const { path } = useCriticalPath(run);
  const options = useMemo(() => filterOptions(run.model), [run.model]);
  const resolved = useMemo(
    () =>
      resolveView(run.model, {
        view: state.view,
        subject: state.subject,
        scenario: state.scenario,
        criticalPath: path,
      }),
    [run.model, state.view, state.subject, state.scenario, path],
  );
  const viewPanel = useId();
  const setFilter = useCallback(
    (change: (filter: ElementFilter) => ElementFilter) => {
      update((current) => ({ ...current, filter: change(current.filter) }));
    },
    [update],
  );
  const select = useCallback(
    (id: string | undefined) => {
      update((current) => ({ ...current, selected: id }));
    },
    [update],
  );
  const setState = useCallback(
    async (id: string, value: OverlayStatus): Promise<void> => {
      await ports.store.v1.overlay.set({ modelId, overlay: { [id]: value } });
    },
    [ports.store, modelId],
  );
  const add = useCallback(
    async (addition: Addition): Promise<void> => {
      await ports.store.v1.models.save({
        modelId,
        model: withAddition(run.model, addition),
      });
    },
    [ports.store, modelId, run.model],
  );
  const viewName = `${viewLabels[state.view]} of ${state.scopes.join(", ")}`;

  return (
    <div className={workspace}>
      <div className={section} data-screen="view">
        <Tabs
          label="View"
          options={viewKinds.map((value) => ({
            value,
            label: viewLabels[value],
          }))}
          selected={state.view}
          onSelect={(view) => {
            update((current) => ({ ...current, view }));
          }}
          panelId={viewPanel}
        />
        <div
          id={viewPanel}
          role="tabpanel"
          aria-label={viewName}
          data-view={state.view}
        >
          {resolved.projection === undefined ? (
            <p role="status" className={muted}>
              {resolved.unavailable}
            </p>
          ) : (
            <div className={canvas}>
              <ViewBoundary
                name={viewName}
                resetKey={`${modelId} ${state.view}`}
              >
                <ProcessView
                  run={run}
                  projection={resolved.projection}
                  label={viewName}
                  layout={ports.layout}
                  filter={state.filter}
                  colorMode={colourScheme}
                  onSelect={select}
                  selected={state.selected}
                />
              </ViewBoundary>
            </div>
          )}
        </div>
        <Legend critical />
      </div>
      <div className={sidebar}>
        {state.selected === undefined ? null : (
          <ElementDetails
            run={run}
            id={state.selected}
            labelOf={labelOf}
            scopes={state.scopes}
            onSetState={setState}
            onAddScope={onAddScope}
          />
        )}
        <WorkLists
          run={run}
          statuses={statuses}
          labelOf={labelOf}
          filter={state.filter}
          selected={state.selected}
          onSelect={select}
          tab={state.tab}
          onTab={(tab) => {
            update((current) => ({ ...current, tab }));
          }}
        />
        <FilterPanel
          filter={state.filter}
          options={options}
          onToggleStatus={(status: Status) => {
            setFilter((filter) => ({
              ...filter,
              statuses: toggled(filter.statuses, status),
            }));
          }}
          onToggleActor={(actor) => {
            setFilter((filter) => ({
              ...filter,
              actors: toggled(filter.actors, actor),
            }));
          }}
          onToggleSource={(source) => {
            setFilter((filter) => ({
              ...filter,
              sources: toggled(filter.sources, source),
            }));
          }}
          onClear={() => {
            setFilter(() => emptyFilter);
          }}
        />
        <AddForm onAdd={add} />
      </div>
    </div>
  );
};

/** A loaded model: its cycles when it has any, since no status can be derived through one, and the workspace otherwise. */
const LoadedModel = (props: LoadedModelProps): ReactElement => {
  const { stored } = props;
  const run = useMemo<Run<OpenIds>>(
    () => ({ model: stored.model, overlay: stored.overlay, facts: noFacts }),
    [stored],
  );
  const cycles = useMemo(() => illegalCycles(run.model), [run.model]);
  const labels = useMemo(
    () =>
      new Map(
        run.model.elements.map((element) => [
          element.id,
          elementLabel(element),
        ]),
      ),
    [run.model],
  );
  const labelOf = useCallback(
    (id: string): string => labels.get(id) ?? id,
    [labels],
  );

  if (cycles.length > 0) {
    return <CyclesNotice cycles={cycles} labelOf={labelOf} />;
  }

  return <Workspace {...props} run={run} labelOf={labelOf} />;
};

/**
 * The model the scopes sync into, read from the store and followed: every write to it, from a sync here or in another tab, shows at once. Before the first sync the store has no such model, which is said plainly rather than shown as a failure, and the sync that creates it shows it.
 * @param props - The ports, the model, the view state and its update.
 * @returns The workspace, or what stands in for it while the model loads or when there is none.
 */
export const ModelArea = (props: ModelAreaProps): ReactElement => {
  const { ports, modelId } = props;
  const model = useModel(ports.store, modelId);

  if (model.status === "loading") {
    return (
      <p role="status" className={muted} data-model="loading">
        Opening the last sync on this device...
      </p>
    );
  }
  if (model.status === "missing") {
    return (
      <p role="status" className={muted} data-model="empty">
        Nothing has been synced for this scope on this device yet. Sync to read
        it.
      </p>
    );
  }
  if (model.status === "failed") {
    return (
      <p role="alert" className={notice.error} data-model="failed">
        The store could not be read: {failureOf(model.error).message}
      </p>
    );
  }

  return <LoadedModel {...props} stored={model.stored} />;
};
