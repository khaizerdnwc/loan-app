"use client";

import {
  type CaseDetail,
  DECLINE_REASON_LABEL,
  OVERRIDE_REASON_LABEL,
  productLabel,
} from "@loan/core";
import {
  Button,
  Card,
  formatDateTime,
  formatMonthlyRate,
  formatPeso,
  Pill,
  SimulatedLabel,
  StageBar,
  StagePill,
} from "@loan/ui";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionsPanel } from "@/components/case/actions-panel";
import { ActivityTimeline } from "@/components/case/activity-timeline";
import { DecisionPanel } from "@/components/case/decision-panel";
import { DecisionRecordDialog } from "@/components/case/decision-record-dialog";
import { LoanAccountPanel } from "@/components/case/loan-account-panel";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const loaded = useApi<CaseDetail>(`/cases/${id}`);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [version, setVersion] = useState(0);
  const [showRecord, setShowRecord] = useState(false);

  useEffect(() => {
    if (loaded.data) setDetail(loaded.data);
  }, [loaded.data]);

  if (!detail) {
    return <LoadState loading={loaded.loading} error={loaded.error} onRetry={loaded.reload} />;
  }

  const c = detail;
  const referred = c.decision?.outcome === "REFER";
  const canReproduce = c.allowedActions.some((a) => a.action === "REPRODUCE_DECISION" && a.enabled);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-mist-500">Applications / {c.reference}</p>
          <h1 className="text-[32px] leading-tight font-extrabold">{c.applicant.fullName}</h1>
          <p className="mt-1 text-sm">
            <strong className="text-ink-900">{productLabel(c.productCode)}</strong> ·{" "}
            {formatPeso(c.requestedAmount)} over {c.requestedTenorMonths} months · {c.purpose} ·
            created {formatDateTime(c.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StagePill status={c.status} />
          {c.escalated && <Pill tone="bad">Escalated</Pill>}
          {c.decision && (
            <Button variant="secondary" onClick={() => setShowRecord(true)}>
              Decision record
            </Button>
          )}
        </div>
      </header>

      <StageBar status={c.status} wasReferred={referred} />
      <OutcomeBanner detail={c} />

      <div className="grid gap-5 min-[1100px]:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          {c.decision ? (
            <DecisionPanel decision={c.decision} />
          ) : (
            <Card title="Decision summary">
              <p className="text-sm">
                Not decided yet. The decision runs when the application is submitted.
              </p>
            </Card>
          )}
          {(c.recommendation || c.approved || c.decline) && <TermsPanel detail={c} />}
          {c.booking && <BookingPanel detail={c} />}
          {c.loanAccountId && <LoanAccountPanel caseId={c.id} />}
        </div>
        <div className="flex flex-col gap-5">
          <ActionsPanel
            detail={c}
            onShowDecision={() => setShowRecord(true)}
            onChanged={(next) => {
              setDetail(next);
              setVersion((v) => v + 1);
            }}
          />
          <ApplicantPanel detail={c} />
          <ActivityTimeline caseId={c.id} version={version} />
        </div>
      </div>

      {c.decision && (
        <DecisionRecordDialog
          decision={c.decision}
          open={showRecord}
          canReproduce={canReproduce}
          onClose={() => setShowRecord(false)}
        />
      )}
    </div>
  );
}

function OutcomeBanner({ detail: c }: { detail: CaseDetail }) {
  if (!c.decision) return null;
  const { outcome, score, grade, referralTriggers, reasonCodes } = c.decision;
  if (outcome === "AUTO_APPROVE") {
    return (
      <div className="rounded-card bg-ok-050 px-5 py-3 text-sm text-ok-700">
        <strong>Auto-approved.</strong> Score {score} ({grade}) in the approve band; every policy
        rule passed.
      </div>
    );
  }
  if (outcome === "REFER") {
    return (
      <div className="rounded-card bg-gold-050 px-5 py-3 text-sm text-gold-700">
        <strong>Referred to human review.</strong> {referralTriggers.join(" · ")}
      </div>
    );
  }
  return (
    <div className="rounded-card bg-bad-050 px-5 py-3 text-sm text-bad-700">
      <strong>Auto-declined.</strong> {reasonCodes.map((r) => r.staff).join(" · ")}
    </div>
  );
}

function ApplicantPanel({ detail: c }: { detail: CaseDetail }) {
  const a = c.applicant;
  const rows: [string, string][] = [
    ["Age", String(a.ageYears)],
    ["Government ID", a.governmentIdMasked],
    ["Employer", a.employer],
    ["Employed", `${a.employmentMonths} months`],
    [
      "WhiteBank customer",
      a.relationshipMonths === 0 ? "New to bank" : `${a.relationshipMonths} months`,
    ],
    ["Monthly income", formatPeso(a.monthlyIncome)],
    ["Monthly obligations", formatPeso(a.monthlyObligations)],
    ["Disburse to", a.depositAccount],
  ];
  return (
    <Card title="Applicant" aside="Synthetic persona">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-mist-500">{label}</dt>
            <dd className="text-right font-mono text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function TermsPanel({ detail: c }: { detail: CaseDetail }) {
  return (
    <Card title="Recommendation and approval">
      {c.recommendation && (
        <div className="rounded-btn border border-line px-4 py-3 text-sm">
          <p>
            <strong className="text-ink-900">{c.recommendation.byName}</strong> recommends{" "}
            {c.recommendation.type === "DECLINE"
              ? "declining"
              : `${c.recommendation.type === "COUNTER_OFFER" ? "a counter-offer of" : "approving"} ${formatPeso(c.recommendation.amount)} over ${c.recommendation.tenorMonths} months`}
            .
          </p>
          {c.recommendation.isOverride && (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <Pill tone="warn">Override</Pill>
              {c.recommendation.overrideReason && (
                <span>
                  {c.recommendation.overrideReason} ·{" "}
                  {OVERRIDE_REASON_LABEL[c.recommendation.overrideReason]}
                </span>
              )}
            </p>
          )}
          {c.recommendation.rationale && (
            <p className="mt-2 text-mist-600">“{c.recommendation.rationale}”</p>
          )}
        </div>
      )}
      {c.approved && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-mist-500">Approved amount</dt>
            <dd className="font-mono text-ink-900">{formatPeso(c.approved.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-mist-500">Tenor</dt>
            <dd className="font-mono text-ink-900">{c.approved.tenorMonths} months</dd>
          </div>
          <div>
            <dt className="text-xs text-mist-500">Rate</dt>
            <dd className="font-mono text-ink-900">{formatMonthlyRate(c.approved.monthlyRate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-mist-500">Monthly instalment</dt>
            <dd className="font-mono text-ink-900">{formatPeso(c.approved.regularInstalment)}</dd>
          </div>
          <div className="col-span-full text-xs text-mist-500">
            {c.approved.by ? "Approved by an approver" : "Approved automatically"} · instalment
            quoted by core banking (simulated)
          </div>
        </dl>
      )}
      {c.decline && (
        <p className="mt-4 rounded-btn bg-bad-050 px-4 py-3 text-sm text-bad-700">
          Declined by {c.decline.byName}: {c.decline.reasonCode} ·{" "}
          {DECLINE_REASON_LABEL[c.decline.reasonCode]}
          {c.decline.note && ` — ${c.decline.note}`}
        </p>
      )}
    </Card>
  );
}

function BookingPanel({ detail: c }: { detail: CaseDetail }) {
  const b = c.booking;
  if (!b) return null;
  const tone = b.status === "BOOKED" ? "ok" : b.status === "FAILED" ? "bad" : "warn";
  return (
    <Card title="Booking" aside={<SimulatedLabel what="core banking" />}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Pill tone={tone}>
          {b.status === "PENDING"
            ? "Awaiting checker"
            : b.status === "BOOKED"
              ? "Booked"
              : "Failed"}
        </Pill>
        <span>
          Maker <strong className="text-ink-900">{b.makerName}</strong>
        </span>
        <span>Attempts {b.attempts}</span>
      </div>
      <p className="mt-3 text-sm">
        Booking key <span className="font-mono text-ink-900">{b.idempotencyKey}</span> — every
        attempt sends this key, so core banking and the disbursement can never run twice.
      </p>
      {b.status === "FAILED" && (
        <p role="alert" className="mt-3 rounded-btn bg-bad-050 px-4 py-3 text-sm text-bad-700">
          {b.lastErrorDetail ?? "The last attempt failed."}
          {b.lastErrorCode && <span className="ml-2 font-mono text-xs">({b.lastErrorCode})</span>}
        </p>
      )}
    </Card>
  );
}
