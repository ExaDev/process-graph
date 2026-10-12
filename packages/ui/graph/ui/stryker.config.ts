import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 73,
    timedOut: 0,
    survived: 105,
    noCoverage: 9,
  }),
  additionalMutate: ["src/**/*.tsx", "!src/**/*.test.tsx"],
});
