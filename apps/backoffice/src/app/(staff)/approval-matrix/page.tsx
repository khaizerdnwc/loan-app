"use client";

import type { ApprovalLevelView } from "@loan/core";
import { PageHeader } from "@/components/app-shell";
import { ApprovalMatrixTable } from "@/components/approval-matrix-table";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

/** The approval matrix (PRD WF-004): delegated authority by product, amount, grade and exception. */
export default function ApprovalMatrixPage() {
  const levels = useApi<ApprovalLevelView[]>("/approval-matrix");
  return (
    <>
      <PageHeader
        title="Approval matrix"
        description="Who may approve what. A case beyond an approver's level is refused, flagged escalated and shown to the level that covers it. Changed by a release in this version, not on screen."
      />
      <LoadState
        loading={levels.loading && !levels.data}
        error={levels.error}
        onRetry={levels.reload}
      />
      {levels.data && <ApprovalMatrixTable levels={levels.data} />}
    </>
  );
}
