import { syncRecordSchema, type SyncRecord } from "./sync-record.ts";
import type {
  AddressBar,
  AppUpdates,
  Observable,
  SyncRecords,
  ThemePreference,
  ThemePreferenceStore,
  TokenStore,
} from "./ports.ts";

/** The keys this app keeps in the origin's local storage, each prefixed so they never meet another app's on a shared origin. */
const keys = {
  token: "process-graph:github-token",
  theme: "process-graph:theme",
  syncRecord: (modelId: string) => `process-graph:sync:${modelId}`,
} as const;

/**
 * The GitHub token in the origin's local storage: on this device only, readable by this origin's pages and nothing else. The app sends it only to GitHub's API.
 * @param storage - The storage to keep it in.
 * @returns The token store.
 */
export const localTokenStore = (storage: Storage): TokenStore => ({
  read: () => storage.getItem(keys.token) ?? undefined,
  write: (token) => {
    storage.setItem(keys.token, token);
  },
  clear: () => {
    storage.removeItem(keys.token);
  },
});

/**
 * Each model's last sync record in local storage, as JSON checked against its schema on the way back in. A record that no longer matches the schema (written by an older version of the app) reads as absent, which only costs the offer to resume.
 * @param storage - The storage to keep the records in.
 * @returns The records.
 */
export const localSyncRecords = (storage: Storage): SyncRecords => ({
  read: (modelId) => {
    const text = storage.getItem(keys.syncRecord(modelId));
    if (text === null) {
      return undefined;
    }
    const parsed = syncRecordSchema.safeParse(JSON.parse(text));

    return parsed.success ? parsed.data : undefined;
  },
  write: (record: SyncRecord) => {
    storage.setItem(keys.syncRecord(record.modelId), JSON.stringify(record));
  },
});

const preferences: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * The theme preference in local storage; the system's theme until a person chooses one.
 * @param storage - The storage to keep it in.
 * @returns The preference store.
 */
export const localThemePreference = (
  storage: Storage,
): ThemePreferenceStore => ({
  read: () =>
    preferences.find(
      (preference) => preference === storage.getItem(keys.theme),
    ) ?? "system",
  write: (preference) => {
    storage.setItem(keys.theme, preference);
  },
});

/**
 * An observable over a browser event: the value is read afresh whenever one of the events fires.
 * @param target - What fires the events.
 * @param events - The events that may change the value.
 * @param read - Reads the current value.
 */
const fromEvents = <T>(
  target: Readonly<EventTarget>,
  events: readonly string[],
  read: () => T,
): Observable<T> => ({
  get: read,
  subscribe: (listener) => {
    for (const event of events) {
      target.addEventListener(event, listener);
    }

    return () => {
      for (const event of events) {
        target.removeEventListener(event, listener);
      }
    };
  },
});

/**
 * Whether the browser believes it is online, following its `online` and `offline` events.
 * @param window - The page's window.
 */
export const browserOnline = (window: Window): Observable<boolean> =>
  fromEvents(window, ["online", "offline"], () => window.navigator.onLine);

/**
 * Whether the system prefers a dark colour scheme, following changes to it.
 * @param window - The page's window.
 */
export const systemPrefersDark = (window: Window): Observable<boolean> => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");

  return fromEvents(query, ["change"], () => query.matches);
};

/** The event this module fires on the window when it replaces the address, since `history.replaceState` fires none. */
const addressChanged = "process-graph:address";

/**
 * The page's query string. Replacing it keeps the path and leaves no history entry, so the back button leaves the app rather than stepping through every filter change; the browser's own navigation still fires `popstate`.
 * @param window - The page's window.
 */
export const browserAddressBar = (window: Window): AddressBar => ({
  search: fromEvents(
    window,
    ["popstate", addressChanged],
    () => window.location.search,
  ),
  replace: (search) => {
    if (search === window.location.search) {
      return;
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
    window.dispatchEvent(new Event(addressChanged));
  },
});

/**
 * Registers the service worker and reports when a new version is waiting. The new version is activated only when the person asks (`apply`), never on its own, so a page is not taken over mid-sync.
 * @param register - `registerSW` from vite-plugin-pwa's `virtual:pwa-register`, injected so this module carries no build-time import.
 * @returns The updates port.
 */
export const serviceWorkerUpdates = (
  register: (options: {
    readonly onNeedRefresh: () => void;
  }) => (reloadPage?: boolean) => Promise<void>,
): AppUpdates => {
  const target = new EventTarget();
  let available = false;
  const update = register({
    onNeedRefresh: () => {
      available = true;
      target.dispatchEvent(new Event("change"));
    },
  });

  return {
    available: fromEvents(target, ["change"], () => available),
    apply: () => {
      void update(true);
    },
  };
};
