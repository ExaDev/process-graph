import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 492,
    timedOut: 0,
    survived: 187,
    noCoverage: 63,
  }),
});
