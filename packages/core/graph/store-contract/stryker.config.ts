import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 944,
    timedOut: 7,
    survived: 371,
    noCoverage: 14,
  }),
});
