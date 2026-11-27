"use client";

import type { CaseList, Role } from "@loan/core";
import { buttonClass } from "@loan/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageHeader } from "@/components/app-shell";
import { CaseTable } from "@/components/case-table";
import { LoadState } from "@/components/load-state";
import { landingFor } from "@/lib/navigation";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const COPY: Partial<Record<Role, { title: string; description: string; empty: string }>> = {
  LOAN_OFFICER: {
    title: "Work queue",
    description:
      "Referred cases waiting for your review and drafts you have started. Open a case to review it and recommend a decision.",
    empty: "Queue is clear: no referred cases or drafts.",
  },
  APPROVER: {
    title: "Approvals",
    description:
      "Recommendations waiting for a decision within your authority. Cases above your authority are in All applications.",
    empty: "No recommendations are waiting for you.",
  },
  LOAN_OPERATIONS: {
    title: "Booking",
    description:
      "Approved loans to sign, book in core banking and disburse. A supervisor checks every booking.",
    empty: "Nothing is ready to sign or book.",
  },
  LOAN_OPERATIONS_SUPERVISOR: {
    title: "Booking checks",
    description:
      "Bookings waiting for a checker, and failed bookings to retry. You cannot check a booking you submitted.",
    empty: "No bookings are waiting for a check.",
  },
};

export default function QueuePage() {
  const me = useSession();
  const router = useRouter();
  const hasQueue = landingFor(me.role) === "/queue";
  const queue = useApi<CaseList>(hasQueue ? "/cases?view=queue" : null);
  // Roles without a queue (admin, compliance) land on their own screen instead.
  useEffect(() => {
    if (!hasQueue) router.replace(landingFor(me.role));
  }, [hasQueue, me.role, router]);
  if (!hasQueue) return null;

  const copy = COPY[me.role] ?? { title: "Queue", description: "", empty: "Nothing here." };

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          me.role === "LOAN_OFFICER" ? (
            <Link href="/cases/new" className={buttonClass("accent")}>
              New application
            </Link>
          ) : undefined
        }
      />
      <LoadState
        loading={queue.loading && !queue.data}
        error={queue.error}
        onRetry={queue.reload}
      />
      {queue.data && <CaseTable cases={queue.data.items} empty={copy.empty} />}
    </>
  );
}
