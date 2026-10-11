import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { isAbsolute } from "node:path";
import { defineConfig } from "vite";

/**
 * The library build. Vanilla Extract runs here, at build time, so `dist/index.js` holds plain class names and `dist/style.css` every rule: a consumer imports the stylesheet once and needs no plugin of its own. Declarations come from `tsc -b` afterwards, since Vite emits none. Every bare import stays an import, resolved from the consumer's own install as `package.json` declares it.
 */
export default defineConfig({
  plugins: [vanillaExtractPlugin()],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    lib: {
      // The theme entry is its own file so that importing it loads no component code; what the two share is emitted once as a chunk.
      entry: { index: "src/index.ts", theme: "src/theme.ts" },
      formats: ["es"],
      cssFileName: "style",
    },
    rolldownOptions: {
      external: (id) =>
        !id.startsWith(".") && !isAbsolute(id) && !id.startsWith("\0"),
    },
    target: "es2024",
    minify: false,
    sourcemap: false,
  },
});
