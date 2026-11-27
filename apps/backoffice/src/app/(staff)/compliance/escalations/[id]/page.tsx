"use client";

import { type AmlEscalationView, PROVIDER_MODE_LABEL, SCREENING_STAGE_LABEL } from "@loan/core";
import {
  buttonClass,
  Callout,
  Card,
  formatDateTime,
  Icon,
  KeyValues,
  SimulatedLabel,
} from "@loan/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useShellCrumb } from "@/components/app-shell";
import { EscalationActions } from "@/components/compliance/escalation-actions";
import { EscalationStatusPill } from "@/components/compliance/escalation-pills";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

/** One AML escalation: the match, what it means for the case, and Compliance's actions. */
export default function EscalationPage() {
  const { id } = useParams<{ id: string }>();
  const loaded = useApi<AmlEscalationView>(`/compliance/escalations/${id}`);
  const [e, setE] = useState<AmlEscalationView | null>(null);
  useShellCrumb(e?.caseReference ?? null);

  useEffect(() => {
    if (loaded.data) setE(loaded.data);
  }, [loaded.data]);

  if (!e)
    return <LoadState loading={loaded.loading} error={loaded.error} onRetry={loaded.reload} />;

  return (
    <div className="flex flex-col gap-5">
      {/* The case header's pattern: crumb back to the list, icon tile, name, facts. Only the
          reference is monospace. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mt-6 grid size-12 shrink-0 place-items-center min-[860px]:mt-1 rounded-btn border border-line bg-mist-100 text-ink-700">
            <Icon name="shieldAlert" />
          </span>
          <div className="min-w-0">
            {/* From 860px the top bar carries this crumb; below that its crumb is hidden. */}
            <p data-crumb="detail-header" className="text-sm text-mist-500 min-[860px]:hidden">
              <Link href="/compliance/escalations" className="hover:text-ink-900">
                AML escalations
              </Link>{" "}
              / <span className="font-mono text-xs">{e.caseReference}</span>
            </p>
            <h1 className="text-display leading-tight font-extrabold">{e.applicantName}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-mist-500">
              <EscalationStatusPill e={e} />
              {SCREENING_STAGE_LABEL[e.stage]} · opened {formatDateTime(e.openedAt)} by{" "}
              {e.openedByName}
            </p>
          </div>
        </div>
        <Link href={`/cases/${e.caseId}`} className={buttonClass("secondary")}>
          Open case {e.caseReference}
        </Link>
      </header>

      <div className="grid gap-5 min-[1100px]:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card title="Screening match" aside={<SimulatedLabel what="KYC / AML screening" />}>
            <KeyValues
              items={[
                { label: "List", value: e.matchedList ?? "Sanctions or watchlist match" },
                { label: "Screened", value: formatDateTime(e.screenedAt) },
                { label: "When", value: SCREENING_STAGE_LABEL[e.stage] },
                {
                  label: "Provider mode",
                  value: PROVIDER_MODE_LABEL[e.providerMode] ?? e.providerMode,
                },
              ]}
            />
            <Callout
              className="mt-4"
              tone={e.status === "CLOSED" ? "neutral" : "warn"}
              lead="What this means:"
            >
              {e.effect}
            </Callout>
          </Card>

          <Card title="Review">
            <KeyValues
              items={[
                {
                  label: "Acknowledged",
                  value: e.acknowledgedAt
                    ? `${formatDateTime(e.acknowledgedAt)} by ${e.acknowledgedByName}`
                    : "Not yet",
                },
                {
                  label: "Closed",
                  value: e.closedAt
                    ? `${formatDateTime(e.closedAt)} by ${e.closedByName}`
                    : "Not yet",
                },
                ...(e.notes
                  ? [
                      {
                        label: "Closing notes",
                        value: <span className="whitespace-pre-wrap">{e.notes}</span>,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </div>
        <EscalationActions escalation={e} onChanged={setE} />
      </div>
    </div>
  );
}
