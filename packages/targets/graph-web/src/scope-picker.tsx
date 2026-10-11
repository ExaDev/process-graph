import { useId, useState, type SubmitEvent, type ReactElement } from "react";
import {
  button,
  chip,
  field,
  input,
  muted,
  primaryButton,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";
import { readScopeInput } from "./scope-input.ts";

export interface ScopePickerProps {
  /** The scopes shown, in order. */
  readonly scopes: readonly string[];
  /** Called with the new list when a scope is added or removed. */
  readonly onChange: (scopes: readonly string[]) => void;
}

/**
 * Chooses what to read: any number of organisations, users and repositories, across organisations, typed as `owner`, `owner/repo`, a source-qualified scope such as `github:owner/repo`, or pasted as a GitHub link.
 * @param props - The scopes and the change listener.
 * @returns The picker.
 */
export const ScopePicker = (props: ScopePickerProps): ReactElement => {
  const { scopes, onChange } = props;
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const headingId = useId();
  const inputId = useId();
  const problemId = useId();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const read = readScopeInput(draft);
    if (read.problem !== undefined) {
      setProblem(read.problem);

      return;
    }
    setProblem(undefined);
    setDraft("");
    if (!scopes.includes(read.scope)) {
      onChange([...scopes, read.scope]);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className={section}
      data-screen="scopes"
    >
      <h2 id={headingId} className={sectionHeading}>
        Scope
      </h2>
      <p className={muted}>
        Organisations, users and repositories to read issues from. An owner
        reads every repository it owns; dependencies on issues elsewhere are
        followed into their own repositories.
      </p>
      {scopes.length === 0 ? (
        <p className={muted}>Nothing chosen yet.</p>
      ) : (
        <ul aria-label="Chosen scopes" className={row}>
          {scopes.map((scope) => (
            <li key={scope} className={chip} data-scope={scope}>
              {scope}
              <button
                type="button"
                className={button}
                aria-label={`Remove ${scope}`}
                onClick={() => {
                  onChange(scopes.filter((other) => other !== scope));
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={field} onSubmit={submit}>
        <label htmlFor={inputId}>Add an organisation, user or repository</label>
        <div className={row}>
          <input
            id={inputId}
            className={input}
            placeholder="owner/repo"
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={problem !== undefined}
            aria-describedby={problem === undefined ? undefined : problemId}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <button type="submit" className={primaryButton}>
            Add
          </button>
        </div>
        {problem === undefined ? null : (
          <p id={problemId} role="alert" className={muted}>
            {problem}
          </p>
        )}
      </form>
    </section>
  );
};
