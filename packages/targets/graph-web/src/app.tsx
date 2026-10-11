import { githubSource } from "@exadev/process-graph-source-github-issues";
import { GraphTheme } from "@exadev/process-graph-ui";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  button,
  header,
  input,
  main,
  muted,
  shell,
  skipLink,
  title,
} from "./app.css.ts";
import { formatInstant } from "./format.ts";
import {
  FailureNotice,
  GapsNotice,
  LinkProblems,
  OfflineNotice,
  UpdateNotice,
} from "./notices.tsx";
import type { AppPorts, ThemePreference } from "./ports.ts";
import { isBoardScope } from "./scope-input.ts";
import { ScopeOptions } from "./scope-options.tsx";
import { ScopePicker } from "./scope-picker.tsx";
import { ScopeSuggestions, type ScopeLister } from "./scope-suggestions.tsx";
import { SyncPanel } from "./sync-panel.tsx";
import { TokenPanel } from "./token-panel.tsx";
import { modelIdOf, type ViewState } from "./url-state.ts";
import { useSync } from "./use-sync.ts";
import { useObservable, useViewState } from "./view-state-hooks.ts";
import { ModelArea } from "./workspace.tsx";

export interface AppProps {
  readonly ports: AppPorts;
}

const themeChoices: readonly {
  readonly value: ThemePreference;
  readonly label: string;
}[] = [
  { value: "system", label: "Follow the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const isPreference = (value: string): value is ThemePreference =>
  themeChoices.some((choice) => choice.value === value);

/** A change of scope starts afresh: the selection and the followed path belong to the model being left. */
const withScopes = (
  state: ViewState,
  scopes: readonly string[],
): ViewState => ({
  ...state,
  scopes,
  selected: undefined,
  scenario: [],
});

/**
 * The process-graph app: choose scopes, sync them from GitHub into the store on this device, and see the work as a flowchart, swimlane, state machine or sequence diagram with what is ready, what is blocked and why. The address carries the view state, so the address is a link to what is on screen; the theme follows the system unless a person picks one.
 * @param props - The ports the app reads and writes through.
 * @returns The app.
 */
export const App = (props: AppProps): ReactElement => {
  const { ports } = props;
  const { state, problems, update } = useViewState(ports.address);
  const online = useObservable(ports.online);
  const prefersDark = useObservable(ports.prefersDark);
  const updateAvailable = useObservable(ports.updates.available);
  const [preference, setPreference] = useState(ports.themePreference.read);
  const [hasToken, setHasToken] = useState(
    () => ports.token.read() !== undefined,
  );
  const [tokenOpen, setTokenOpen] = useState(false);
  const syncWhenShown = useRef<string | undefined>(undefined);
  const themeId = useId();
  const mainId = useId();
  const modelId = modelIdOf(state.scopes);
  const sync = useSync(ports, modelId, state.scopes, state.syncFilter);
  const theme =
    preference === "system" ? (prefersDark ? "dark" : "light") : preference;
  const { start } = sync;
  // The token is read at the moment of each listing and handed straight to the source, as a sync does, so it never enters React state.
  const listScopes: ScopeLister = useCallback(
    async (parent, after) => {
      const token = ports.token.read();
      const github =
        token === undefined ? undefined : ports.sources(token)(githubSource);
      if (github === undefined) {
        throw new Error("Save a GitHub token to list what it reaches.");
      }
      const from = after === undefined ? {} : { after };

      return parent === undefined
        ? github.v1.scopes.roots(from)
        : github.v1.scopes.children({ scope: parent, ...from });
    },
    [ports],
  );
  const addScope = (scope: string): void => {
    update((current) =>
      current.scopes.includes(scope)
        ? current
        : withScopes(current, [...current.scopes, scope]),
    );
  };

  // A scope added from an element's details is synced as soon as its model is the one shown, so expanding on demand is one action.
  useEffect(() => {
    if (syncWhenShown.current === modelId) {
      syncWhenShown.current = undefined;
      start();
    }
  }, [modelId, start]);

  const gaps =
    sync.state.phase === "idle" || sync.state.progress === undefined
      ? (sync.record?.gaps ?? [])
      : sync.state.progress.gaps;

  return (
    <GraphTheme theme={theme}>
      <div className={shell}>
        <a href={`#${mainId}`} className={skipLink}>
          Skip to the work
        </a>
        <header className={header}>
          <h1 className={title}>Process graph</h1>
          <label htmlFor={themeId}>Theme</label>
          <select
            id={themeId}
            className={input}
            value={preference}
            onChange={(event) => {
              const { value } = event.target;
              if (isPreference(value)) {
                ports.themePreference.write(value);
                setPreference(value);
              }
            }}
          >
            {themeChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={button}
            aria-expanded={tokenOpen || !hasToken}
            onClick={() => {
              setTokenOpen(!tokenOpen);
            }}
          >
            GitHub token
          </button>
        </header>
        {online ? null : <OfflineNotice />}
        {updateAvailable ? (
          <UpdateNotice onReload={ports.updates.apply} />
        ) : null}
        <LinkProblems problems={problems} />
        {sync.state.phase === "failed" ? (
          <FailureNotice
            failure={sync.state.failure}
            formatTime={formatInstant}
            onChangeToken={() => {
              setTokenOpen(true);
            }}
          />
        ) : null}
        <GapsNotice gaps={gaps} />
        <main id={mainId} className={main} tabIndex={-1}>
          {tokenOpen || !hasToken ? (
            <TokenPanel
              hasToken={hasToken}
              onSave={(token) => {
                ports.token.write(token);
                setHasToken(true);
                setTokenOpen(false);
              }}
              onForget={() => {
                ports.token.clear();
                setHasToken(false);
              }}
            />
          ) : null}
          <ScopePicker
            scopes={state.scopes}
            onChange={(scopes) => {
              update((current) => withScopes(current, scopes));
            }}
          />
          {state.scopes.length === 0 ? null : (
            <ScopeOptions
              filter={state.syncFilter}
              hasBoard={state.scopes.some(isBoardScope)}
              onChange={(syncFilter) => {
                update((current) => ({ ...current, syncFilter }));
              }}
            />
          )}
          {hasToken && online ? (
            <ScopeSuggestions
              list={listScopes}
              scopes={state.scopes}
              onAdd={addScope}
            />
          ) : null}
          {state.scopes.length === 0 ? (
            <p className={muted}>
              Choose an organisation or repository to see its work.
            </p>
          ) : (
            <>
              <SyncPanel sync={sync} hasToken={hasToken} online={online} />
              <ModelArea
                ports={ports}
                modelId={modelId}
                state={state}
                update={update}
                colourScheme={theme}
                onAddScope={(scope) => {
                  const scopes = state.scopes.includes(scope)
                    ? state.scopes
                    : [...state.scopes, scope];
                  update((current) => withScopes(current, scopes));
                  syncWhenShown.current = modelIdOf(scopes);
                }}
              />
            </>
          )}
        </main>
      </div>
    </GraphTheme>
  );
};
