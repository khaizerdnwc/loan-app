/** Every house ESLint rule is listed, registered, configured and tested. See `_house-rules.ts`. */
import { checkHouseRuleParity } from "../_house-rules";
import type { HouseCheck } from "./_registry";

const check: HouseCheck = {
  id: "house-rule-parity",
  description:
    "every house rule is in the src/index.js header, the rules map, the root eslint.config.js and a RuleTester run with a valid and an invalid case",
  // A development gate: a rule-registry slip must never block a deploy.
  devOnly: true,
  run(ctx) {
    return checkHouseRuleParity(ctx.repoRoot).map((message) => ({
      file: "packages/eslint-house/src/index.js",
      message: `${message} — follow the house-rule-authoring skill`,
    }));
  },
};

export default check;
