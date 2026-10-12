import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export interface PackageStrykerOptions {
  /** Every package's own `stryker.config.ts` passes this. Left unset (`undefined`) until a real CI run has actually measured a baseline. A mutation-score gate chosen before ever running the suite is exactly the arbitrary magic number this workspace's own conventions exist to avoid. */
  readonly breakThreshold?: number;
  /** Extra glob patterns to mutate, appended to the package's own `src/**\/*.ts` default. */
  readonly additionalMutate?: readonly string[];
}

/**
 * Deliberately no `incremental`/`incrementalFile`: `@stryker-mutator/vitest-runner`'s own `capabilities()` reports no test-location support, so per StrykerJS's own documented incremental-mode limitations ("test runner plugins offer varying levels of support... 'Nothing' means only mutant changes are detected, not test changes"), Stryker has no way to notice a test file changed and will silently reuse a stale cached verdict for every mutant that test used to cover. Confirmed directly: a package's own mutation score stayed at its pre-fix value in CI, reusing a restored incremental report, even after new tests were added specifically to kill previously-surviving mutants in that exact package.
 */
export function packageStrykerConfig(
  options: PackageStrykerOptions = {},
): PartialStrykerOptions {
  const { breakThreshold, additionalMutate = [] } = options;

  return {
    packageManager: "pnpm",
    testRunner: "vitest",
    // Explicit, not Stryker's own default auto-discovery: that default resolves `@stryker-mutator/*` plugins relative to wherever `@stryker-mutator/core` itself physically lives, which under pnpm's isolated node_modules is a separate virtual-store entry from the checker/test-runner packages each package installs alongside it. Confirmed directly (`--logLevel debug` showed Stryker scanning core's own node_modules/@stryker-mutator/, which pnpm never populates with sibling plugins), producing "Cannot find Checker plugin \"typescript\"" even though the package was genuinely installed and resolvable via plain Node module resolution the whole time. An explicit list uses ordinary resolution from this config's own location instead, which pnpm's per-package node_modules symlink already satisfies.
    plugins: [
      "@stryker-mutator/typescript-checker",
      "@stryker-mutator/vitest-runner",
    ],
    checkers: ["typescript"],
    coverageAnalysis: "perTest",
    mutate: [
      "src/**/*.ts",
      "!src/**/*.test.ts",
      "!src/test-support/**",
      // A worker file a test spawns through `new Worker(new URL(...))` runs in its own thread, outside the sandboxed vitest process Stryker instruments — so its mutants can never be killed, only error or sit uncovered. Mutating test infrastructure no in-process test can observe is noise, not coverage.
      "!src/**/*.worker.ts",
      // A Vanilla Extract style module is evaluated by the Vite plugin's own compiler, which turns it into a stylesheet and the class names a test imports; the instrumented module never runs in the test process, so every one of its mutants reports no coverage, even where a test reads a rule back through `getComputedStyle`.
      "!src/**/*.css.ts",
      ...additionalMutate,
    ],
    reporters: ["html", "clear-text", "progress"],
    htmlReporter: { fileName: "reports/mutation/mutation.html" },
    thresholds:
      breakThreshold === undefined
        ? { high: 90, low: 70 }
        : { high: 90, low: 70, break: breakThreshold },
  };
}
