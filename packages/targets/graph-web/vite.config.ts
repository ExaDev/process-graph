import { darkValues, lightValues } from "@exadev/process-graph-ui";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { iconFiles, pwaIcons } from "./build/icons.ts";

/**
 * The path the app is served under, from `GRAPH_WEB_BASE` (such as `/process-graph/` on a project site), else the root. It must start and end with a slash; the manifest's `start_url` and `scope` and the service worker's scope all follow it.
 */
const base = process.env.GRAPH_WEB_BASE ?? "/";
if (!base.startsWith("/") || !base.endsWith("/")) {
  throw new Error(`GRAPH_WEB_BASE must start and end with "/", not "${base}"`);
}

/** The icon's tile in the theme's accent, its glyph in the page background, so the icon and the app read as one. */
const iconColours = {
  tile: lightValues.colour.accent,
  glyph: lightValues.colour.background,
};

/** The browser chrome follows the page: each colour scheme's background from the theme contract's values. */
const themeColourTags: Plugin = {
  name: "process-graph-web-theme-colour",
  transformIndexHtml: (): HtmlTagDescriptor[] => [
    {
      tag: "meta",
      attrs: {
        name: "theme-color",
        media: "(prefers-color-scheme: light)",
        content: lightValues.colour.background,
      },
      injectTo: "head",
    },
    {
      tag: "meta",
      attrs: {
        name: "theme-color",
        media: "(prefers-color-scheme: dark)",
        content: darkValues.colour.background,
      },
      injectTo: "head",
    },
  ],
};

/**
 * The app build. Vanilla Extract compiles the app's own styles; graph-ui and graph-react-flow ship theirs compiled. The store runs in a module worker, so workers build as ES modules. SQLite's wasm module loads its `.wasm` file relative to itself, which dependency pre-bundling would break, so it is excluded from it.
 *
 * Neither the dev server nor the preview server sets `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`: the store is built to work without cross-origin isolation (see graph-sqlite-wasm), and the end-to-end tests check that the page is not isolated.
 *
 * The service worker precaches the app shell, including the SQLite wasm and the icons, so the app opens offline and reads its last sync from the origin private file system. Requests to GitHub are cross-origin and never cached. A new version waits until the person chooses to reload (`registerType: "prompt"`), since taking over a page mid-sync would drop the sync.
 */
export default defineConfig({
  base,
  plugins: [
    vanillaExtractPlugin(),
    pwaIcons(iconColours),
    themeColourTags,
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Process graph",
        short_name: "Process graph",
        description:
          "What is ready, what is blocked and why, across GitHub issues in several organisations and repositories, as a flowchart, swimlane, state machine or sequence diagram.",
        theme_color: lightValues.colour.accent,
        background_color: lightValues.colour.background,
        lang: "en-GB",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: iconFiles()
          .filter((file) => file.size !== undefined)
          .map((file) => ({
            src: file.path,
            sizes: `${String(file.size)}x${String(file.size)}`,
            type: file.type,
            purpose: file.purpose,
          })),
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,wasm}"],
        runtimeCaching: [],
      },
    }),
  ],
  oxc: { jsx: { runtime: "automatic" } },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  build: {
    target: "es2024",
    rolldownOptions: {
      output: {
        // The largest dependencies each get a chunk of their own, so a new version of the app changes only the chunks whose code changed and the service worker fetches only those again, and no chunk outgrows the size Workbox precaches by default.
        codeSplitting: {
          groups: [
            { name: "elkjs", test: /[\\/]node_modules[\\/]elkjs[\\/]/u },
            {
              name: "react-flow",
              test: /[\\/]node_modules[\\/](@xyflow|d3-[\w-]+)[\\/]/u,
            },
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/u,
            },
          ],
        },
      },
    },
  },
});
