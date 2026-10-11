import { packageStrykerConfig } from "../../../../stryker.shared.ts";

export default packageStrykerConfig({
  additionalMutate: ["src/**/*.tsx", "!src/**/*.test.tsx"],
});
