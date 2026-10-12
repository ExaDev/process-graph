import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 81,
    timedOut: 0,
    survived: 11,
    noCoverage: 7,
  }),
});
