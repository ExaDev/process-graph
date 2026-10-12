import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 195,
    timedOut: 0,
    survived: 55,
    noCoverage: 19,
  }),
  additionalMutate: ["src/**/*.tsx", "!src/**/*.test.tsx"],
});
