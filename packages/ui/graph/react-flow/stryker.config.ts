import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 97,
    timedOut: 0,
    survived: 60,
    noCoverage: 5,
  }),
  additionalMutate: ["src/**/*.tsx", "!src/**/*.test.tsx"],
});
