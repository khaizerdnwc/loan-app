import { FEATURE_FLAG_LABEL, type FeatureFlag } from "@loan/core";
import { Callout } from "@loan/ui";

/**
 * A module the bank has switched off (PRD PLT-006): a calm statement of fact, not an error.
 * No retry and no controls: nothing on the page works until an administrator switches it on.
 */
export function ModuleOff({ flag, kept }: { flag: FeatureFlag; kept?: string }) {
  return (
    <Callout tone="neutral" lead={`${FEATURE_FLAG_LABEL[flag]} is switched off for this bank.`}>
      <p className="mt-1">
        An administrator can switch it on under Feature flags.{kept ? ` ${kept}` : ""}
      </p>
    </Callout>
  );
}
