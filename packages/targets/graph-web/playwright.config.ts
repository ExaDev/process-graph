import { defineConfig } from "@playwright/test";

/** Vite's own default port for `vite preview`, pinned with `--strictPort` so the tests never drive another server that happens to hold it. */
const previewPort = 4173;
const baseURL = `http://127.0.0.1:${String(previewPort)}`;

/**
 * End-to-end tests against the production build, served by `vite preview` as a static host would serve it, with no cross-origin isolation headers. The build itself comes from the `_build` task that `_test:e2e` depends on. Chromium is the browser CI installs for graph-sqlite-wasm's browser tests, at the version this Playwright expects. GitHub's API is answered by a local fixture server the tests start, reached by routing the browser's requests to api.github.com, so the browser still addresses GitHub and the token checks see the real request.
 *
 * `--host 127.0.0.1`: Vite binds `localhost`, which can resolve to `::1` only, where the IPv4 base URL would be refused.
 */
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: process.env.CI !== undefined,
  reporter: "list",
  // A fixed locale and time zone, so dates the app formats read the same on every machine.
  use: { baseURL, locale: "en-GB", timezoneId: "UTC" },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${String(previewPort)} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
