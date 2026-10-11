import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../../eslint.shared.ts";

/** The modules behind the package's subpath exports other than the root, each a pure re-export of the private packages that subpath bundles, declared as entry points so the barrel rules hold them to re-exports as they do `src/index.ts`. */
const subpathEntries = [
  "src/layout.ts",
  "src/source/github.ts",
  "src/source/github/node.ts",
  "src/store.ts",
  "src/store/node.ts",
  "src/store/wasm.ts",
  "src/store/wasm/worker.ts",
  "src/react.ts",
  "src/ui.ts",
  "src/react-flow.ts",
  "src/cli.ts",
];

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    projects: [
      "./tsconfig.json",
      "./tsconfig.node.json",
      "./tsconfig.browser.json",
    ],
    isomorphic: true,
    barrelEntries: subpathEntries,
    // The browser integration test starts workers on the bundled browser store.
    browserGlobals: true,
    // The bin is a Node launcher that is run, never imported, and these subpaths are the Node-only ones by design; the root entry and every other subpath stay isomorphic.
    isomorphicExemptions: [
      "src/bin.ts",
      "src/cli.ts",
      "src/store/node.ts",
      "src/source/github/node.ts",
    ],
  }),
);
