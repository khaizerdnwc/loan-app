"use client";

import type { CaseList } from "@loan/core";
import { buttonClass, Icon } from "@loan/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { type CaseScope, CaseScopeFilter, inScope, parseScope } from "@/components/case-scope";
import { CaseTable } from "@/components/case-table";
import { LoadState } from "@/components/load-state";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const EMPTY: Record<CaseScope, string> = {
  open: "No applications in progress.",
  closed: "No closed applications yet.",
  all: "No applications yet.",
};

/**
 * The prototype's All applications screen: In progress / Closed / All with counts over the
 * same table, and the officer's "New application" action. Closed means declined, disbursed,
 * withdrawn or expired (core's CLOSED_CASE_STATUSES). The choice lives in the URL
 * (`?scope=closed|all`; none means in progress), so Back from a case restores it.
 */
export default function AllCasesPage() {
  // useSearchParams needs a Suspense boundary in a statically rendered page.
  return (
    <Suspense fallback={null}>
      <AllCases />
    </Suspense>
  );
}

function AllCases() {
  const me = useSession();
  const router = useRouter();
  const cases = useApi<CaseList>("/cases?view=all");
  const scope = parseScope(useSearchParams().get("scope"));
  const setScope = (next: CaseScope) =>
    router.replace(next === "open" ? "/cases" : `/cases?scope=${next}`, { scroll: false });
  return (
    <>
      <PageHeader
        title="All applications"
        description="Every application your role can see, newest first. All channels use the same decision pipeline."
        actions={
          me.role === "LOAN_OFFICER" ? (
            <Link href="/cases/new" className={buttonClass("primary")}>
              <Icon name="plus" className="size-4" />
              New application
            </Link>
          ) : undefined
        }
      />
      <LoadState
        loading={cases.loading && !cases.data}
        error={cases.error}
        onRetry={cases.reload}
      />
      {cases.data && (
        <>
          <div className="mb-4">
            <CaseScopeFilter items={cases.data.items} value={scope} onChange={setScope} />
          </div>
          <CaseTable
            cases={cases.data.items.filter((c) => inScope(c.status, scope))}
            empty={EMPTY[scope]}
          />
        </>
      )}
    </>
  );
}
