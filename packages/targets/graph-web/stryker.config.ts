import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 783,
    timedOut: 0,
    survived: 313,
    noCoverage: 115,
  }),
  additionalMutate: ["src/**/*.tsx", "!src/**/*.test.tsx"],
});
