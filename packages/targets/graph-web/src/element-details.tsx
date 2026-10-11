import {
  useBlockedChain,
  useImpact,
  useWhyStatus,
  type Run,
} from "@exadev/process-graph-react";
import type { OpenIds, OverlayStatus } from "@exadev/process-graph-schema";
import { DetailPanel } from "@exadev/process-graph-ui";
import { useId, useState, type ReactElement } from "react";
import { button, muted, row, section, sectionHeading } from "./app.css.ts";
import { failureOf } from "./failure.ts";
import { githubIssueOf } from "./github-issue.ts";

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
  /** The selected element. */
  readonly id: string;
  readonly labelOf: (id: string) => string;
  /** The scopes the model was synced from. */
  readonly scopes: readonly string[];
  /** Sets the element's run state in the store, as the command line's `set` does. */
  readonly onSetState: (id: string, state: OverlayStatus) => Promise<void>;
  /** Adds a scope and syncs it, so work outside the scope can be expanded on demand. */
  readonly onAddScope: (scope: string) => void;
}

/**
 * The selected element: why it has its status, what blocks it and what it holds up (the command line's `why`, `blocked` and `impact`), its issue on GitHub, controls to set its run state, and, for an issue in a repository outside the scope, a control that adds that repository to the scope.
 * @param props - The run, the element and the actions.
 * @returns The details, or a note when the element is not in the model.
 */
export const ElementDetails = (props: ElementDetailsProps): ReactElement => {
  const { run, id, labelOf, scopes, onSetState, onAddScope } = props;
  const explanation = useWhyStatus(run, id);
  const { blockers } = useBlockedChain(run, id);
  const impact = useImpact(run, id);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const headingId = useId();
  const element = run.model.elements.find((candidate) => candidate.id === id);
  if (element === undefined || explanation === undefined) {
    return (
      <p className={muted} role="status">
        The selected element, {id}, is not in this model.
      </p>
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
