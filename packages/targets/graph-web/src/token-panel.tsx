import { useId, useState, type SubmitEvent, type ReactElement } from "react";
import {
  button,
  field,
  input,
  list,
  muted,
  primaryButton,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";

export interface TokenPanelProps {
  /** Whether a token is kept on this device. The token itself is never passed to the screen. */
  readonly hasToken: boolean;
  readonly onSave: (token: string) => void;
  readonly onForget: () => void;
}

/**
 * Where a person gives the app a GitHub token, with what the token needs and where it goes. The field never shows a saved token: it is write-only, so the screen cannot leak it.
 * @param props - Whether a token is saved, and what saving and forgetting do.
 * @returns The panel.
 */
export const TokenPanel = (props: TokenPanelProps): ReactElement => {
  const { hasToken, onSave, onForget } = props;
  const [draft, setDraft] = useState("");
  const headingId = useId();
  const inputId = useId();
  const helpId = useId();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const token = draft.trim();
    if (token === "") {
      return;
    }
    onSave(token);
    setDraft("");
  };

  return (
    <section
      aria-labelledby={headingId}
      className={section}
      data-screen="token"
    >
      <h2 id={headingId} className={sectionHeading}>
        GitHub token
      </h2>
      <div id={helpId} className={field}>
        <p className={muted}>
          The app reads issues through GitHub&apos;s API with a token you give
          it. It needs read access only:
        </p>
        <ul className={list}>
          <li>
            A fine-grained token with read-only <strong>Issues</strong> and{" "}
            <strong>Metadata</strong> permissions on the repositories you want
            to see, for each organisation that owns them.
          </li>
          <li>
            Or a classic token with no scopes for public repositories, or the{" "}
            <code>repo</code> scope to include private ones.
          </li>
        </ul>
        <p className={muted}>
          The token is kept in this browser&apos;s storage on this device only.
          It is sent to api.github.com and nowhere else, and never shown again
          once saved.
        </p>
      </div>
      <form className={row} onSubmit={submit}>
        <label htmlFor={inputId}>
          {hasToken ? "Replace the token" : "Token"}
        </label>
        <input
          id={inputId}
          className={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={helpId}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <button type="submit" className={primaryButton}>
          Save on this device
        </button>
        {hasToken ? (
          <button type="button" className={button} onClick={onForget}>
            Forget the token
          </button>
        ) : null}
      </form>
      <p className={muted} role="status">
        {hasToken
          ? "A token is saved on this device."
          : "No token is saved yet."}
      </p>
    </section>
  );
};
