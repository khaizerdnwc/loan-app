"use client";

import type { CaseDetail } from "@loan/core";

/**
 * The caption under the approved terms: who approved them and where the instalment came
 * from. When core banking could not quote the instalment it says so, and what still works:
 * the case re-asks core each time it is opened, and booking takes the schedule from core.
 */
export function ApprovedTermsNote({ approved }: { approved: NonNullable<CaseDetail["approved"]> }) {
  const who = approved.by ? "Approved by an approver" : "Approved automatically";
  return (
    <p className="text-xs text-mist-500">
      {approved.regularInstalment === null
        ? `${who}. Core banking (simulated) could not quote the monthly instalment just now; it is asked again each time this case is opened, and booking takes the full schedule from core. The approved terms are unaffected.`
        : `${who} · instalment quoted by core banking (simulated)`}
    </p>
  );
}
