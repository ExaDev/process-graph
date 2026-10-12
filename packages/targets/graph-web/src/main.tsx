import "@exadev/process-graph-ui/style.css";
import "@exadev/process-graph-react-flow/style.css";
import { createGraphSourceRouter } from "@exadev/process-graph-source-contract";
import {
  createGitHubIssuesSource,
  githubSource,
} from "@exadev/process-graph-source-github-issues";
import { connectGraphStore } from "@exadev/process-graph-sqlite-wasm";
import { createRouterClient } from "@orpc/server";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app.tsx";
import {
  browserAddressBar,
  browserDownload,
  browserOnline,
  localSyncRecords,
  localThemePreference,
  localTokenStore,
  serviceWorkerUpdates,
  systemPrefersDark,
} from "./browser.ts";
import {
  ephemeralPersistence,
  persistenceAllowed,
  type PersistencePorts,
} from "./persistence.ts";
import type { AppPorts } from "./ports.ts";

// The composition root: the only module that knows which store, sources and browser APIs the app runs on. Every screen reaches them through `AppPorts`.

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html must contain a #root element to mount into");
}

/**
 * What outlives the page, on an origin of its own: the store in a dedicated worker on SQLite wasm over the origin private file system, reached over the store contract's oRPC client; the token, sync records and theme preference in local storage; and the service worker.
 * @returns The ports.
 */
const devicePersistence = (): PersistencePorts => ({
  store: connectGraphStore(
    new Worker(new URL("store.worker.ts", import.meta.url), { type: "module" }),
  ),
  token: localTokenStore(window.localStorage),
  syncRecords: localSyncRecords(window.localStorage),
  themePreference: localThemePreference(window.localStorage),
  updates: serviceWorkerUpdates(registerSW),
});

// Whether anything outlives the page is decided once, here, from the origin: on a shared github.io origin the store, the token, the settings and the service worker are all in memory or absent, so the worker and `registerSW` are never started.
const persistent = persistenceAllowed(window.location);

const ports: AppPorts = {
  persistence: persistent ? "device" : "ephemeral",
  ...(persistent ? devicePersistence() : ephemeralPersistence()),
  // The GitHub source runs in the page, called through the source contract's in-process oRPC client. The token goes only into the adapter's Authorization header for requests to GitHub's API, and the fetch it calls reaches nothing else.
  sources: (token) => (prefix) =>
    prefix === githubSource
      ? createRouterClient(
          createGraphSourceRouter(
            createGitHubIssuesSource({
              token: async () => Promise.resolve(token),
              fetch: async (url, init) => fetch(url, init),
            }),
          ),
        )
      : undefined,
  address: browserAddressBar(window),
  online: browserOnline(window),
  prefersDark: systemPrefersDark(window),
  download: browserDownload(document),
};

createRoot(root).render(
  <StrictMode>
    <App ports={ports} />
  </StrictMode>,
);
