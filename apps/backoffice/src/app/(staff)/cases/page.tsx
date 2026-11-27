"use client";

import type { CaseList } from "@loan/core";
import { PageHeader } from "@/components/app-shell";
import { CaseTable } from "@/components/case-table";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

export default function AllCasesPage() {
  const cases = useApi<CaseList>("/cases?view=all");
  return (
    <>
      <PageHeader
        title="All applications"
        description="Every application your role can see, newest first. All channels use the same decision pipeline."
      />
      <LoadState
        loading={cases.loading && !cases.data}
        error={cases.error}
        onRetry={cases.reload}
      />
      {cases.data && <CaseTable cases={cases.data.items} empty="No applications yet." />}
    </>
  );
}
