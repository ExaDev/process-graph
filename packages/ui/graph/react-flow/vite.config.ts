import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { isAbsolute, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const entry = resolve(import.meta.dirname, "src/index.ts");

/**
 * Imports React Flow's own stylesheet once, into the entry, at build time only. The import lives here rather than in `src/index.ts` because TypeScript keeps a side-effect import in the emitted declarations, where every consumer's compiler would then have to resolve a CSS file.
 */
const reactFlowStylesheet: Plugin = {
  name: "process-graph-react-flow-stylesheet",
  transform: (code, id) =>
    id === entry
      ? `import "@xyflow/react/dist/style.css";\n${code}`
      : undefined,
};

/**
 * The library build. Vanilla Extract runs here, at build time, and React Flow's stylesheet is bundled with this package's own rules, so `dist/style.css` is the one stylesheet a consumer imports for this package and no build plugin is needed. Declarations come from `tsc -b` afterwards, since Vite emits none. Every bare import other than a stylesheet stays an import, resolved from the consumer's own install as `package.json` declares it.
 */
export default defineConfig({
  plugins: [vanillaExtractPlugin(), reactFlowStylesheet],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    lib: {
      entry,
      formats: ["es"],
      fileName: "index",
      cssFileName: "style",
    },
    rolldownOptions: {
      external: (id) =>
        !id.startsWith(".") &&
        !isAbsolute(id) &&
        !id.startsWith("\0") &&
        !id.endsWith(".css"),
    },
    target: "es2024",
    minify: false,
    sourcemap: false,
  },
});
