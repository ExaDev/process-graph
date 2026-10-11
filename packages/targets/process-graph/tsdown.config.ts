import { defineConfig } from "tsdown";

/**
 * The published `process-graph` package is a bundle. Each subpath of its exports map is one entry here, built from the `src/` module of the same path, and the private workspace packages those modules re-export are inlined, JavaScript and declarations alike, so the published files never name a package that is not on the registry. Code two entries share is emitted once as a chunk, so importing one subpath loads only what that subpath reaches.
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
  tsconfig: "tsconfig.node.json",
  clean: true,
});
