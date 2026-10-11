import js from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import { type Config, defineConfig } from "eslint/config";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import depend from "eslint-plugin-depend";
import yml from "eslint-plugin-yml";
import exadevRecommendedTypeChecked, {
  plugin as exadev,
  workspaceArchitectureConfig,
} from "@exadev/eslint-config";
import globals from "globals";
import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

/**
 * The lint configuration every package in this workspace shares, as a function rather than a static array. What differs between packages is structural: which tsconfig programs a package runs, whether it is Worker-isomorphic, whether its exports map is a firewall. Those are the parameters below. The rule set itself is never parameterised: every package gets the same rules, only the wiring differs, so a rule added once reaches every package rather than needing restating in every package.
 *
 * Built on ESLint core's `defineConfig()`, not `tseslint.config()`. The latter is deprecated in favour of the former. documents.js's own real config stays on `tseslint.config()` only because one specific package there registers a plugin whose types are incompatible with `defineConfig`'s stricter `Plugin` type; nothing in this workspace has that problem, so there is no reason to inherit the older API.
 */

/**
 * Node's own builtin module list, reduced to base specifiers, so the isomorphism ban stays complete as Node adds modules rather than needing a hand-maintained list that inevitably misses one.
 */
const nodeBuiltinBaseModules: readonly string[] = [
  ...new Set(
    builtinModules
      .filter((name) => !name.startsWith("_") && !name.startsWith("node:"))
      .map((name) =>
        name.includes("/") ? name.slice(0, name.indexOf("/")) : name,
      ),
  ),
].sort();

/**
 * Matches a bare Node builtin specifier and any subpath of one. A regex, not a `group` glob pattern: `no-restricted-imports`'s `group` uses gitignore semantics over path segments, which would also match a relative import that merely shares a name with a builtin (`./util/base64`). The regex is tested against the raw specifier, which keeps its `./` prefix, so it can't collide with a relative import.
 */
const bareNodeBuiltinPattern = `^(${nodeBuiltinBaseModules.join("|")})(/.*)?$`;

const isomorphicNodeImportMessage =
  "This is a Worker-isomorphic package: node:* imports are banned in runtime src. Use a Web API or an injected value instead.";
const isomorphicBareBuiltinMessage =
  "This is a Worker-isomorphic package: bare Node builtin imports are banned in runtime src. Use a Web API or an injected value instead.";
const isomorphicBufferMessage =
  "Buffer is Node-only; this Worker-isomorphic package uses Uint8Array.";

/**
 * Linting for the data and prose files beside the code (JSON, Markdown, YAML), defined once and used by both the root config and every package's own config, so it is one decision applied everywhere rather than a copy per package.
 */
const jsoncLanguageOptions: Record<string, unknown> = {
  allowTrailingCommas: true,
};

const dataFileLintConfig = defineConfig(
  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json", "**/turbo.json"],
    plugins: { json },
    language: "json/json",
    extends: [json.configs.recommended],
  },
  {
    files: ["**/*.jsonc", "**/tsconfig*.json", "**/turbo.json"],
    plugins: { json },
    language: "json/jsonc",
    languageOptions: jsoncLanguageOptions,
    extends: [json.configs.recommended],
  },
  markdown.configs.recommended,
  {
    files: ["**/*.{yml,yaml}"],
    plugins: { yml },
  },
  yml.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["**/*.{yml,yaml}"],
  })),
  {
    // A GitHub workflow trigger with no filters is a bare key. `pull_request:` means "every pull request", a genuinely absent value, which is what the schema expects. Scoped to .github/ rather than off outright, since an accidentally empty value elsewhere usually is a real mistake.
    files: [".github/**/*.{yml,yaml}"],
    rules: { "yml/no-empty-mapping-value": "off" },
  },
  {
    files: ["**/package.json"],
    plugins: { depend, exadev },
    rules: {
      // eslint-plugin-react is the plugin @exadev/eslint-config's React block is built on, so the React packages' lint needs it whatever replacement the ban list suggests.
      "depend/ban-dependencies": [
        "error",
        { allowed: ["lint-staged", "eslint-plugin-react"] },
      ],
      // A script turbo caches must not pass a fixing flag: turbo hashes a task's inputs before it runs, so a cached check that rewrites them passes in CI having fixed files only inside the runner, and a later cache hit replays a log describing a fix that was never applied. Checking stays in the cached `_lint`; fixing is the uncached `_lint:fix`.
      "exadev/no-fix-in-cached-task-script": "error",
    },
  },
  // Workspace-architecture boundary rules (no-uphill-dependency, no-dependency-cycle), from @exadev/eslint-config rather than a local plugin. Rank is the group's own rank, so a package may depend on its own group or any group below it and never on one above: core (the model, its analysis and the ports) has no knowledge of adapters, adapters implement ports without knowing a UI, UI packages render the model without knowing a target, and targets compose everything. Root's own package.json also matches "**/package.json" when root calls packageLintConfig(), but the rule itself no-ops there since the graph is built from pnpm-workspace.yaml's own package globs, none of which match root's directory (".").
  ...workspaceArchitectureConfig({
    groups: [
      { name: "core", path: "packages/core", rank: 0 },
      { name: "adapters", path: "packages/adapters", rank: 1 },
      { name: "ui", path: "packages/ui", rank: 2 },
      { name: "targets", path: "packages/targets", rank: 3 },
    ],
  }),
);

const alwaysIgnored: readonly string[] = [
  "dist",
  "coverage",
  "node_modules",
  "schemas",
  "reports",
  ".stryker-tmp",
  ".turbo",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  // A generated lockfile, not source: linting it at all is pointless, and --fix was silently rewriting its YAML quote style (single to double) on every lint run, producing lockfile-wide diffs with no real content change.
  "pnpm-lock.yaml",
];

/** One `no-restricted-imports` pattern entry: a gitignore-semantics `group`, or an anchored `regex` tested against the raw specifier. */
interface RestrictedImportPattern {
  readonly group?: readonly string[];
  readonly regex?: string;
  readonly message: string;
}

export interface PackageLintOptions {
  /** Always `import.meta.dirname` from the calling package's own `eslint.config.ts`. Pins the TSConfig root so the parser is never confused by a different package's tsconfig elsewhere in the tree. */
  readonly tsconfigRootDir: string;

  /**
   * The TSConfig programs to resolve linted files against, relative to the package. Defaults to the dual program layout every isomorphic-capable package here uses: `tsconfig.json` is the web-only gate (lib ES2024+WebWorker, `types: []`, tests excluded) that makes the isomorphism constraint a type-level fact, not only a lint rule; `tsconfig.node.json` covers tests, dev scripts, and config files under Node types. A package with one program covering everything passes just that one.
   */
  readonly projects?: readonly string[];

  /** Appended to the always-ignored set above, for paths only this package has. */
  readonly additionalIgnores?: readonly string[];

  /**
   * Whether this package is Worker-isomorphic, i.e. its published `src/` must run unchanged in a Cloudflare Worker or a browser. When true, runtime `src/` is barred from importing `node:*` or a bare Node builtin and from using the `Buffer` global. Test files and test-support are exempt.
   */
  readonly isomorphic?: boolean;

  /** Runtime `src/` paths exempt from the isomorphism guard on top of test files, for an executed entry point rather than an importable one (e.g. `src/bin.ts`, a Node-only launcher). */
  readonly isomorphicExemptions?: readonly string[];

  /** Whether Node's globals are in scope for every linted file. Defaults to true: what enforces isomorphism is the import ban and the web-only TSConfig program, not the absence of ambient global types. */
  readonly nodeGlobals?: boolean;

  /** Whether browser/Worker globals (`self`, `Worker`, `navigator`, `MessagePort`, `fetch`, ...) are in scope for every linted file. Defaults to false: most packages here are Node-hosted targets or isomorphic libraries with no direct browser API usage of their own. A package with a real `new Worker(...)`/`self.addEventListener(...)` call sets this to `true`. */
  readonly browserGlobals?: boolean;

  /** Whether `no-non-null-assertion` is enforced. Defaults to `'error'`. */
  readonly nonNullAssertion?: "error" | "off";

  /** Extra `no-restricted-syntax` selectors banned in `src/**`, merged with the workspace-wide defaults (none by default). Lets one package ban a construct the rest of the workspace allows. */
  readonly additionalRestrictedSyntax?: readonly {
    readonly selector: string;
    readonly message: string;
  }[];

  /** `@exadev/eslint-config`'s own `exadev/barrel-policy` rule defaults to `"banned"` in its recommended type-checked preset. Every published package here exposes exactly one barrel at `src/index.ts`, so this defaults to `"single"` instead. It explicitly overrides the base preset's own default, rather than merely relying on it. */
  readonly barrelPolicy?: "banned" | "single" | "siblings" | "off";

  /** The package's other entry files, beside `src/index.ts`: the modules behind its subpath exports, as globs relative to the package. Each is held to the barrel rules (only re-exports) and may re-export another package's surface, as `src/index.ts` may. A package with a single entry point gives none. */
  readonly barrelEntries?: readonly string[];

  /**
   * Set for a package that renders React components: `.tsx` files get `@exadev/eslint-config`'s React block (eslint-plugin-react with the automatic JSX runtime, the hooks rules and the jsx-a11y rules). `version` is the React version the rules assume; pass React's own `version` export, so it follows the package's dependency. eslint-plugin-react's `"detect"` cannot be used, because it reads the file name through a context method ESLint 10 removed.
   */
  readonly react?: { readonly version: string };
}

export function packageLintConfig(options: PackageLintOptions): Config[] {
  const {
    tsconfigRootDir,
    projects = ["./tsconfig.json", "./tsconfig.node.json"],
    additionalIgnores = [],
    isomorphic = false,
    nodeGlobals = true,
    browserGlobals = false,
    nonNullAssertion = "error",
    isomorphicExemptions = [],
    additionalRestrictedSyntax = [],
    barrelPolicy = "single",
    barrelEntries = [],
    react,
  } = options;

  const typeScriptFiles = ["**/*.ts", "**/*.tsx"];
  const runtimeSrcFiles = ["src/**/*.ts", "src/**/*.tsx"];
  const runtimeSrcExemptions = [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/test-support/**",
    ...isomorphicExemptions,
  ];

  const isomorphicImportPatterns: readonly RestrictedImportPattern[] =
    isomorphic
      ? [
          {
            group: ["node:*", "node:*/**"],
            message: isomorphicNodeImportMessage,
          },
          {
            regex: bareNodeBuiltinPattern,
            message: isomorphicBareBuiltinMessage,
          },
        ]
      : [];

  return defineConfig(
    { ignores: [...alwaysIgnored, ...additionalIgnores] },
    {
      files: typeScriptFiles,
      languageOptions: {
        parserOptions: { project: [...projects], tsconfigRootDir },
        ...(nodeGlobals || browserGlobals
          ? {
              globals: {
                ...(nodeGlobals ? globals.node : {}),
                ...(browserGlobals ? globals.browser : {}),
              },
            }
          : {}),
      },
      extends: [
        js.configs.recommended,
        exadevRecommendedTypeChecked,
        tseslint.configs.strictTypeChecked,
      ],
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/restrict-template-expressions": [
          "error",
          { allowNumber: true },
        ],
        "@typescript-eslint/no-non-null-assertion": nonNullAssertion,
        "exadev/barrel-policy":
          barrelPolicy === "off"
            ? "off"
            : [
                "error",
                barrelEntries.length === 0
                  ? { mode: barrelPolicy }
                  : { mode: barrelPolicy, entries: [...barrelEntries] },
              ],
      },
    },
    {
      files: ["**/*.test.{ts,tsx}"],
      rules: {
        "@typescript-eslint/no-empty-function": [
          "error",
          { allow: ["arrowFunctions", "asyncFunctions"] },
        ],
        // This workspace's own test kinds extend past exadev/test-file-kind's default (unit, integration, e2e): "smoke" is the vitest project name every package declares in its own vitest.config.ts for the built-artefact check (test:smoke).
        "exadev/test-file-kind": [
          "error",
          {
            kinds: ["unit", "integration", "e2e", "smoke"],
          },
        ],
      },
    },
    isomorphicImportPatterns.length > 0
      ? {
          files: runtimeSrcFiles,
          ignores: [...runtimeSrcExemptions],
          rules: {
            "no-restricted-imports": [
              "error",
              { patterns: [...isomorphicImportPatterns] },
            ],
          },
        }
      : [],
    isomorphic
      ? {
          files: runtimeSrcFiles,
          ignores: [...runtimeSrcExemptions],
          rules: {
            "no-restricted-globals": [
              "error",
              { name: "Buffer", message: isomorphicBufferMessage },
            ],
          },
        }
      : [],
    additionalRestrictedSyntax.length > 0
      ? {
          files: runtimeSrcFiles,
          ignores: [...runtimeSrcExemptions],
          rules: {
            "no-restricted-syntax": ["error", ...additionalRestrictedSyntax],
          },
        }
      : [],
    react === undefined
      ? []
      : [
          ...exadev.configs.react,
          { settings: { react: { version: react.version } } },
        ],
    dataFileLintConfig,
    // Last, deliberately: bundles eslint-config-prettier, turning off every stylistic rule that would otherwise fight the formatter. Placed earlier, a later config could re-enable one and the two would disagree forever, each "fixing" the other's output.
    prettierRecommended,
  );
}
