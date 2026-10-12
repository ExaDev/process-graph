import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 28,
    timedOut: 0,
    survived: 1,
    noCoverage: 58,
  }),
});
