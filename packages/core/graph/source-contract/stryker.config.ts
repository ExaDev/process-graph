import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 267,
    timedOut: 1,
    survived: 138,
    noCoverage: 8,
  }),
});
