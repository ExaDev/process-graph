import {
  breakThresholdFromBaseline,
  packageStrykerConfig,
} from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  breakThreshold: breakThresholdFromBaseline({
    killed: 1002,
    timedOut: 38,
    survived: 311,
    noCoverage: 224,
  }),
});
