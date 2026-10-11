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
  browserOnline,
  localSyncRecords,
  localThemePreference,
  localTokenStore,
  serviceWorkerUpdates,
  systemPrefersDark,
} from "./browser.ts";
import type { AppPorts } from "./ports.ts";

// The composition root: the only module that knows which store, sources and browser APIs the app runs on. Every screen reaches them through `AppPorts`.

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html must contain a #root element to mount into");
}

/** The store, in a dedicated worker on SQLite wasm over the origin private file system, reached over the store contract's oRPC client. */
const store = connectGraphStore(
  new Worker(new URL("store.worker.ts", import.meta.url), { type: "module" }),
);

const ports: AppPorts = {
  store,
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
  token: localTokenStore(window.localStorage),
  syncRecords: localSyncRecords(window.localStorage),
  themePreference: localThemePreference(window.localStorage),
  address: browserAddressBar(window),
  online: browserOnline(window),
  prefersDark: systemPrefersDark(window),
  updates: serviceWorkerUpdates(registerSW),
};

createRoot(root).render(
  <StrictMode>
    <App ports={ports} />
  </StrictMode>,
);
