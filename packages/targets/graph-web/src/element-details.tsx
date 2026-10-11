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
import { githubIssueOf, type GitHubIssue } from "./github-issue.ts";
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
  /** Adds scopes and syncs them, so work outside the scope can be expanded on demand. */
  readonly onAddScopes: (scopes: readonly string[]) => void;
  /** The store, for the element's place in the hierarchy its source reports. */
  readonly store: HierarchyClient;
  readonly modelId: string;
  /** The model's revision, so a write that changes the hierarchy is read again. */
  readonly revision: number;
  /** Selects another element, as a parent or child link does. */
  readonly onSelect: (id: string) => void;
}

/** The GitHub issue an element is bound to, if it is one. */
const issueOfElement = (
  element: Element<string, OpenIds> | undefined,
): GitHubIssue | undefined =>
  element?.kind === "activity" && element.source !== undefined
    ? githubIssueOf(element.source)
    : undefined;

/**
 * Whether the scopes leave out an issue: neither its repository nor its owner is one of them.
 * @param scopes - The scopes.
 * @param issue - The issue.
 */
const outsideOf = (scopes: readonly string[], issue: GitHubIssue): boolean =>
  !scopes.includes(issue.repositoryScope) && !scopes.includes(issue.ownerScope);

/**
 * The repositories outside the scopes of the work an element is linked to: what it depends on and what depends on it, its parents and its sub-tasks. Each is named once, sorted, as a scope to add.
 * @param run - The run, whose transitions link the element.
 * @param id - The element.
 * @param related - Its parents and sub-tasks, from the hierarchy the store keeps.
 * @param scopes - The scopes the model was synced from.
 */
const linkedScopesOutside = (
  run: Run<OpenIds>,
  id: string,
  related: readonly string[],
  scopes: readonly string[],
): readonly string[] => {
  const linked = [
    ...run.model.transitions.flatMap((transition) =>
      transition.source === id
        ? [transition.target]
        : transition.target === id
          ? [transition.source]
          : [],
    ),
    ...related,
  ];

  return [
    ...new Set(
      linked.flatMap((other) => {
        const issue = issueOfElement(
          run.model.elements.find((element) => element.id === other),
        );

        return issue !== undefined && outsideOf(scopes, issue)
          ? [issue.repositoryScope]
          : [];
      }),
    ),
  ].sort();
};

/** Joins names into a sentence's list: "a", "a and b", "a, b and c". */
const listFormat = new Intl.ListFormat("en-GB", {
  style: "long",
  type: "conjunction",
});

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
 * The selected element: why it has its status, what blocks it and what it holds up (the command line's `why`, `blocked` and `impact`), what it is a sub-task of and its own sub-tasks (`ancestors` and `children`), each a link that selects it, its issue on GitHub, controls to set its run state, controls to record the artefacts it consumes or produces and the facts its conditions read (`set artefact`, `set fact`),, for an issue in a repository outside the scope, a control that adds that repository to the scope, and one that loads in one step every repository outside the scope that the work it is linked to lives in.
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
    onAddScopes,
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
  const issue = issueOfElement(element);
  const outside = issue !== undefined && outsideOf(scopes, issue);
  const expansion =
    hierarchy.status === "loaded"
      ? linkedScopesOutside(
          run,
          id,
          [...hierarchy.parents, ...hierarchy.children],
          scopes,
        )
      : [];
  const expansionId = useId();

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
      {expansion.length === 0 ? null : (
        <div className={row} data-screen="expand">
          <button
            type="button"
            className={button}
            aria-describedby={expansionId}
            onClick={() => {
              onAddScopes(expansion);
            }}
          >
            Load what this links to
          </button>
          <span id={expansionId} className={muted}>
            {`Adds ${listFormat.format(
              expansion.map((scope) => scope.slice(scope.indexOf(":") + 1)),
            )} to the scope and syncs ${expansion.length === 1 ? "it" : "them"}.`}
          </span>
        </div>
      )}
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
                onAddScopes([issue.repositoryScope]);
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
