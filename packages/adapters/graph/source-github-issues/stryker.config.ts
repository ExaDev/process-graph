import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 276,
    timedOut: 0,
    survived: 108,
    noCoverage: 26,
  }),
});
