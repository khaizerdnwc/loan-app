"use client";

import type { CaseDetail, CaseList, CaseSummary, Role } from "@loan/core";
import { buttonClass, Icon, SegmentedFilter, useToast } from "@loan/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { QueueBody, type StageFilter } from "@/components/queue-body";
import { api, errorMessage } from "@/lib/api";
import { landingFor } from "@/lib/navigation";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const COPY: Partial<Record<Role, { title: string; description: string; empty: string }>> = {
  LOAN_OFFICER: {
    title: "Work queue",
    description:
      "Your drafts and cases, and the team's referred cases waiting for an owner. Pick a referral to take it on, or open a case to review it.",
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

/** The loan officers' queue split by owner (PRD WF-002): the team's, mine, or unassigned. */
type Ownership = "ALL" | "MINE" | "UNASSIGNED";
const OWNERSHIP: Record<Ownership, (me: string) => (c: CaseSummary) => boolean> = {
  ALL: () => () => true,
  MINE: (me) => (c) => c.ownerId === me,
  UNASSIGNED: () => (c) => c.ownerId === null,
};
const OWNERSHIP_LABEL: Record<Ownership, string> = {
  ALL: "Team",
  MINE: "Mine",
  UNASSIGNED: "Unassigned",
};
const OWNERSHIP_EMPTY: Record<Exclude<Ownership, "ALL">, string> = {
  MINE: "You own no open cases. Pick one from Unassigned.",
  UNASSIGNED: "No referral is waiting for an owner.",
};

export default function QueuePage() {
  const me = useSession();
  const router = useRouter();
  const [stage, setStage] = useState<StageFilter>("ALL");
  const [ownership, setOwnership] = useState<Ownership>("ALL");
  const [picking, setPicking] = useState<string | null>(null);
  const toast = useToast();
  const hasQueue = landingFor(me.role) === "/queue";
  const queue = useApi<CaseList>(hasQueue ? "/cases?view=queue" : null);
  // Roles without a queue (admin, compliance) land on their own screen instead.
  useEffect(() => {
    if (!hasQueue) router.replace(landingFor(me.role));
  }, [hasQueue, me.role, router]);
  if (!hasQueue) return null;

  const copy = COPY[me.role] ?? { title: "Queue", description: "", empty: "Nothing here." };
  const officer = me.role === "LOAN_OFFICER";
  const all = queue.data?.items ?? [];
  const items = officer ? all.filter(OWNERSHIP[ownership](me.id)) : all;

  async function pick(c: CaseSummary) {
    if (picking) return;
    setPicking(c.id);
    try {
      await api<CaseDetail>(`/cases/${c.id}/pick`, { method: "POST" });
      toast(`Picked ${c.reference} — it is in your cases now`);
    } catch (e) {
      // Someone may have picked it first: the reload shows who owns it now.
      toast(errorMessage(e), "warn");
    }
    await queue.reload();
    setPicking(null);
  }

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          me.role === "LOAN_OFFICER" ? (
            <Link href="/cases/new" className={buttonClass("accent")}>
              <Icon name="plus" className="size-4" />
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
      {queue.data && officer && (
        <div className="mb-4">
          <SegmentedFilter
            label="Filter by owner"
            value={ownership}
            onChange={setOwnership}
            options={(Object.keys(OWNERSHIP) as Ownership[]).map((value) => ({
              value,
              label: OWNERSHIP_LABEL[value],
              count: all.filter(OWNERSHIP[value](me.id)).length,
            }))}
          />
        </div>
      )}
      {queue.data && (
        <QueueBody
          staffRole={me.role}
          items={items}
          stage={stage}
          onStage={setStage}
          empty={officer && ownership !== "ALL" ? OWNERSHIP_EMPTY[ownership] : copy.empty}
          onPick={officer ? pick : undefined}
          pickingId={picking}
        />
      )}
    </>
  );
}
