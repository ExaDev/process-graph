import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

/** Where a bundled UI package's compiled stylesheet is, resolved through that package's own `./style.css` export. */
const stylesheetOf = (name: string): string =>
  fileURLToPath(import.meta.resolve(`${name}/style.css`));

/**
 * The published `process-graph` package is a bundle. Each subpath of its exports map is one entry here, built from the `src/` module of the same path, and the private workspace packages those modules re-export are inlined, JavaScript and declarations alike, so the published files never name a package that is not on the registry. Code two entries share is emitted once as a chunk, so importing one subpath loads only what that subpath reaches.
 *
 * The bundler carries no CSS across from the UI packages, which compile their Vanilla Extract styles into a `style.css` of their own, so each stylesheet is copied beside its subpath and exported as `<subpath>/style.css`.
 *
 * `onlyBundle` is the guarantee rather than a hint: the build fails if anything from `node_modules` other than a workspace package would be inlined, so every third-party library stays an import resolved from the consumer's own install, as declared in `package.json`. Node builtins stay imports too, since the neutral platform leaves them unresolved; the entries that reach them (`cli`, `bin`, `store/node`, `source/github/node`) are the Node-only ones.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    layout: "src/layout.ts",
    "source/github": "src/source/github.ts",
    "source/github/node": "src/source/github/node.ts",
    store: "src/store.ts",
    "store/node": "src/store/node.ts",
    "store/wasm": "src/store/wasm.ts",
    "store/wasm/worker": "src/store/wasm/worker.ts",
    react: "src/react.ts",
    ui: "src/ui.ts",
    "react-flow": "src/react-flow.ts",
    cli: "src/cli.ts",
    bin: "src/bin.ts",
  },
  format: ["esm"],
  platform: "neutral",
  dts: { resolver: "tsc" },
  deps: {
    neverBundle: [/^node:/],
    onlyBundle: [/^@exadev\/process-graph-/],
    dts: { alwaysBundle: [/^@exadev\/process-graph-/] },
  },
  copy: [
    { from: stylesheetOf("@exadev/process-graph-ui"), to: "dist/ui" },
    {
      from: stylesheetOf("@exadev/process-graph-react-flow"),
      to: "dist/react-flow",
    },
  ],
  tsconfig: "tsconfig.node.json",
  clean: true,
});
