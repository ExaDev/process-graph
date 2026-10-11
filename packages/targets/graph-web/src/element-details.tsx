import type { FactRecord } from "@exadev/process-graph-domain";
import {
  useBlockedChain,
  useImpact,
  useWhyStatus,
  type Run,
} from "@exadev/process-graph-react";
import type {
  Element,
  OpenIds,
  OverlayStatus,
} from "@exadev/process-graph-schema";
import { DetailPanel } from "@exadev/process-graph-ui";
import { useId, useState, type ReactElement } from "react";
import {
  button,
  list,
  muted,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";
import { failureOf } from "./failure.ts";
import { githubIssueOf } from "./github-issue.ts";
import { useHierarchy, type HierarchyClient } from "./hierarchy.ts";
import { RunFacts, type ArtefactState, type FactState } from "./run-facts.tsx";

/** The run states a person can set, and the text of each button. */
const settable: readonly {
  readonly state: OverlayStatus;
  readonly label: string;
}[] = [
  { state: "done", label: "Mark done" },
  { state: "open", label: "Mark open" },
  { state: "unknown", label: "Mark unknown" },
];

export interface ElementDetailsProps {
  readonly run: Run<OpenIds>;
  /** The selected element, which the model declares. */
  readonly element: Element<string, OpenIds>;
  readonly labelOf: (id: string) => string;
  /** The scopes the model was synced from. */
  readonly scopes: readonly string[];
  /** The model's fact record as the store holds it. */
  readonly facts: FactRecord;
  /** Records an artefact's state in the store, as the command line's `set artefact` does. */
  readonly onSetArtefact: (id: string, state: ArtefactState) => Promise<void>;
  /** Records a named fact's value in the store, as the command line's `set fact` does. */
  readonly onSetFact: (name: string, state: FactState) => Promise<void>;
  /** Sets the element's run state in the store, as the command line's `set` does. */
  readonly onSetState: (id: string, state: OverlayStatus) => Promise<void>;
  /** Adds a scope and syncs it, so work outside the scope can be expanded on demand. */
  readonly onAddScope: (scope: string) => void;
  /** The store, for the element's place in the hierarchy its source reports. */
  readonly store: HierarchyClient;
  readonly modelId: string;
  /** The model's revision, so a write that changes the hierarchy is read again. */
  readonly revision: number;
  /** Selects another element, as a parent or child link does. */
  readonly onSelect: (id: string) => void;
}

interface RelativesProps {
  readonly heading: string;
  /** The relation each listed element has to the selected one, for `data-hierarchy`. */
  readonly relation: "parent" | "child";
  readonly ids: readonly string[];
  readonly labelOf: (id: string) => string;
  readonly onSelect: (id: string) => void;
}

/** One side of the hierarchy: each element a button that selects it. */
const Relatives = (props: RelativesProps): ReactElement => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} data-hierarchy={props.relation}>
      <h3 id={headingId} className={sectionHeading}>
        {props.heading}
      </h3>
      <ul className={list} aria-labelledby={headingId}>
        {props.ids.map((id) => (
          <li key={id}>
            <button
              type="button"
              className={button}
              data-element={id}
              onClick={() => {
                props.onSelect(id);
              }}
            >
              {props.labelOf(id)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

/**
 * The selected element: why it has its status, what blocks it and what it holds up (the command line's `why`, `blocked` and `impact`), what it is a sub-task of and its own sub-tasks (`ancestors` and `children`), each a link that selects it, its issue on GitHub, controls to set its run state, controls to record the artefacts it consumes or produces and the facts its conditions read (`set artefact`, `set fact`), and, for an issue in a repository outside the scope, a control that adds that repository to the scope.
 * @param props - The run, the element and the actions.
 * @returns The details.
 */
export const ElementDetails = (props: ElementDetailsProps): ReactElement => {
  const {
    run,
    element,
    labelOf,
    scopes,
    facts,
    onSetState,
    onSetArtefact,
    onSetFact,
    onAddScope,
    store,
    modelId,
    revision,
    onSelect,
  } = props;
  const { id } = element;
  const hierarchy = useHierarchy(store, modelId, id, revision);
  const explanation = useWhyStatus(run, id);
  const { blockers } = useBlockedChain(run, id);
  const impact = useImpact(run, id);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const headingId = useId();
  if (explanation === undefined) {
    throw new Error(
      "unreachable: useWhyStatus explains every element it is given",
    );
  }
  const issue =
    element.kind === "activity" && element.source !== undefined
      ? githubIssueOf(element.source)
      : undefined;
  const outside =
    issue !== undefined &&
    !scopes.includes(issue.repositoryScope) &&
    !scopes.includes(issue.ownerScope);

  return (
    <div className={section} data-screen="details">
      <DetailPanel
        element={element}
        explanation={explanation}
        blockers={blockers}
        impact={impact}
        labelOf={labelOf}
      />
      {hierarchy.status === "failed" ? (
        <p role="alert" className={muted}>
          The sub-tasks could not be read: {hierarchy.message}
        </p>
      ) : hierarchy.status === "loaded" ? (
        <>
          {hierarchy.parents.length === 0 ? null : (
            <Relatives
              heading="Part of"
              relation="parent"
              ids={hierarchy.parents}
              labelOf={labelOf}
              onSelect={onSelect}
            />
          )}
          {hierarchy.children.length === 0 ? null : (
            <Relatives
              heading="Sub-tasks"
              relation="child"
              ids={hierarchy.children}
              labelOf={labelOf}
              onSelect={onSelect}
            />
          )}
        </>
      ) : null}
      <section aria-labelledby={headingId} className={row}>
        <h3 id={headingId} className={sectionHeading}>
          Run state
        </h3>
        {settable.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            className={button}
            aria-pressed={run.overlay[id] === state}
            onClick={() => {
              setProblem(undefined);
              onSetState(id, state).catch((error: unknown) => {
                setProblem(failureOf(error).message);
              });
            }}
          >
            {label}
          </button>
        ))}
      </section>
      {problem === undefined ? null : (
        <p role="alert" className={muted}>
          The run state was not changed: {problem}
        </p>
      )}
      <RunFacts
        model={run.model}
        element={element}
        facts={facts}
        onSetArtefact={onSetArtefact}
        onSetFact={onSetFact}
      />
      {issue === undefined ? null : (
        <div className={row}>
          <a href={issue.url} target="_blank" rel="noreferrer">
            Open the issue on GitHub
          </a>
          {outside ? (
            <button
              type="button"
              className={button}
              onClick={() => {
                onAddScope(issue.repositoryScope);
              }}
            >
              Add {issue.repository} to the scope
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};
