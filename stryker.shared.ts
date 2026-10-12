import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

/**
 * Packages with no Stryker run, each for a reason a run cannot get round:
 *
 * - `@exadev/process-graph-sqlite-wasm`: its tests drive a real browser over OPFS, which Stryker's sandboxed copies cannot start, so a run could only score the few in-process unit tests as if they were the package's coverage.
 *
 * Every other workspace package has its own `stryker.config.ts` and `_test:mutation` script.
 */
export interface PackageStrykerOptions {
  /** Every package's own `stryker.config.ts` passes this, as `breakThresholdFromBaseline` of the counts a completed CI run on `main` measured for it. Re-measure and update the counts when a package's tests kill more mutants, so the gate rises with them; a value chosen without a measured run would be an arbitrary number. */
  readonly breakThreshold?: number;
  /** Extra glob patterns to mutate, appended to the package's own `src/**\/*.ts` default. */
  readonly additionalMutate?: readonly string[];
}

/** One package's verdict counts from a completed Stryker run, as its clear-text report's `All files` row prints them (`# killed`, `# timeout`, `# survived`, `# no cov`). Errored and ignored mutants are left out, as Stryker leaves them out of the score. */
export interface MutationBaseline {
  readonly killed: number;
  readonly timedOut: number;
  readonly survived: number;
  readonly noCoverage: number;
}

/** Stryker states a mutation score, and compares it with `thresholds.break`, as a percentage. */
const PERCENT = 100;

/**
 * The break threshold a measured baseline supports: the package's mutation score with every timed-out mutant counted as survived, floored to a whole percentage.
 *
 * Stryker counts a timed-out mutant as detected, but whether a mutant runs past its time budget depends on how loaded the runner is, so the same mutant can time out on one run and complete, killed or survived, on the next. Killed, survived and no-coverage verdicts depend only on the code and its tests. Counting every timeout as survived therefore gives the lowest score the same code and tests can produce, so the gate absorbs run-to-run variation without a margin picked by hand, and fails only when a change loses a kill. Flooring keeps the threshold a whole number at or below that score.
 *
 * The result is never below zero and never above the measured score (killed plus timed out over every scored mutant). Raise a package's threshold by re-measuring it once its tests kill more mutants.
 * @throws RangeError when the baseline scored no mutant, since a score over nothing measures nothing.
 */
export function breakThresholdFromBaseline(baseline: MutationBaseline): number {
  const { killed, timedOut, survived, noCoverage } = baseline;
  const scored = killed + timedOut + survived + noCoverage;
  if (scored === 0) {
    throw new RangeError(
      "a mutation baseline needs at least one scored mutant to derive a break threshold from",
    );
  }

  return Math.floor((killed * PERCENT) / scored);
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
