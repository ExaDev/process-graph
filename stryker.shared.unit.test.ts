import { describe, expect, it } from "vitest";

import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "./stryker.shared.ts";

describe("breakThresholdFromBaseline", () => {
  it.each([
    {
      name: "counts every timed-out mutant as survived",
      baseline: { killed: 6, timedOut: 2, survived: 2, noCoverage: 0 },
      threshold: 60,
    },
    {
      name: "counts mutants with no coverage against the score",
      baseline: { killed: 3, timedOut: 0, survived: 0, noCoverage: 1 },
      threshold: 75,
    },
    {
      name: "floors a fractional score to the whole percentage below it",
      baseline: { killed: 2, timedOut: 0, survived: 1, noCoverage: 0 },
      threshold: 66,
    },
    {
      name: "is the whole score when every mutant is killed",
      baseline: { killed: 7, timedOut: 0, survived: 0, noCoverage: 0 },
      threshold: 100,
    },
    {
      name: "is zero when no mutant is killed, however many timed out",
      baseline: { killed: 0, timedOut: 4, survived: 1, noCoverage: 1 },
      threshold: 0,
    },
  ])("$name", ({ baseline, threshold }) => {
    expect(breakThresholdFromBaseline(baseline)).toBe(threshold);
  });

  it("never exceeds the measured score, which counts timeouts as detected", () => {
    const baseline = { killed: 5, timedOut: 3, survived: 1, noCoverage: 2 };
    const scored =
      baseline.killed +
      baseline.timedOut +
      baseline.survived +
      baseline.noCoverage;
    const detected = baseline.killed + baseline.timedOut;
    const threshold = breakThresholdFromBaseline(baseline);

    // Scaled by the all-killed threshold, which is the whole percentage, so the test names no percentage scale of its own.
    expect(threshold * scored).toBeLessThanOrEqual(
      breakThresholdFromBaseline({
        killed: 1,
        timedOut: 0,
        survived: 0,
        noCoverage: 0,
      }) * detected,
    );
  });

  it("rejects a baseline that scored no mutant", () => {
    expect(() =>
      breakThresholdFromBaseline({
        killed: 0,
        timedOut: 0,
        survived: 0,
        noCoverage: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("packageStrykerConfig", () => {
  it("gates on the break threshold it is given", () => {
    const baseline = { killed: 3, timedOut: 0, survived: 0, noCoverage: 1 };
    const breakThreshold = breakThresholdFromBaseline(baseline);

    expect(packageStrykerConfig({ breakThreshold }).thresholds).toEqual({
      high: 90,
      low: 70,
      break: breakThreshold,
    });
  });

  it("sets no break threshold until a baseline is measured", () => {
    expect(packageStrykerConfig().thresholds).toEqual({ high: 90, low: 70 });
  });
});
