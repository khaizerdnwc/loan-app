"use client";

import {
  type CaseDetail,
  DECLINE_REASON_LABEL,
  OVERRIDE_REASON_LABEL,
  productLabel,
  WITHDRAW_REASON_LABEL,
} from "@loan/core";
import {
  Button,
  Callout,
  Card,
  formatAmountsInText,
  formatDateTime,
  formatMonthlyRate,
  formatPeso,
  Icon,
  KeyValues,
  Pill,
  SimulatedLabel,
  StageBar,
  StagePill,
} from "@loan/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useShellCrumb } from "@/components/app-shell";
import { ActionsPanel } from "@/components/case/actions-panel";
import { ActivityTimeline } from "@/components/case/activity-timeline";
import { ApprovedTermsNote } from "@/components/case/approved-terms-note";
import { BookingChecklistPanel } from "@/components/case/booking-checklist-panel";
import { ConsentPanel } from "@/components/case/consent-panel";
import { DecisionPanel } from "@/components/case/decision-panel";
import { DecisionRecordDialog } from "@/components/case/decision-record-dialog";
import { IndicativeRepayment } from "@/components/case/indicative-repayment";
import { LoanAccountPanel } from "@/components/case/loan-account-panel";
import { OutcomeBanner } from "@/components/case/outcome-banner";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const loaded = useApi<CaseDetail>(`/cases/${id}`);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [version, setVersion] = useState(0);
  const [showRecord, setShowRecord] = useState(false);
  useShellCrumb(detail?.reference ?? null);

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
      {/* The prototype's case header: crumb, icon tile, name, a row of facts; stage and
          record on the right. Only the reference is monospace. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mt-6 grid size-12 shrink-0 min-[860px]:mt-1 place-items-center rounded-btn border border-line bg-mist-100 text-ink-700">
            <Icon name="file" />
          </span>
          <div className="min-w-0">
            {/* The top bar shows this crumb from 860px; below that its crumb is hidden, so the
                case header carries it, with the same wording. */}
            <p data-crumb="case-header" className="text-sm text-mist-500 min-[860px]:hidden">
              <Link href="/cases" className="hover:text-ink-900">
                All applications
              </Link>{" "}
              / <span className="font-mono text-xs">{c.reference}</span>
            </p>
            <h1 className="text-display leading-tight font-extrabold">{c.applicant.fullName}</h1>
            <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mist-500">
              <span>
                <strong className="text-ink-900">{productLabel(c.productCode)}</strong> ·{" "}
                {formatPeso(c.requestedAmount)} over {c.requestedTenorMonths} months
              </span>
              <span>{c.purpose}</span>
              <span>Created {formatDateTime(c.createdAt)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StagePill status={c.status} />
          {c.escalated && <Pill tone="bad">Escalated</Pill>}
          {c.decision && (
            <Button variant="secondary" onClick={() => setShowRecord(true)}>
              Decision record
            </Button>
          )}
        </div>
      </header>

      <StageBar status={c.status} wasReferred={referred} closedFrom={c.closedFrom} />
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
              {c.indicativeRepayment && (
                <div className="mt-4">
                  <IndicativeRepayment quote={c.indicativeRepayment} />
                </div>
              )}
            </Card>
          )}
          {c.withdrawal && <WithdrawalPanel withdrawal={c.withdrawal} />}
          {(c.recommendation || c.approved || c.decline) && <TermsPanel detail={c} />}
          {c.bookingChecklist && <BookingChecklistPanel items={c.bookingChecklist} />}
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
          <ConsentPanel
            key={c.consent?.capturedAt ?? "none"}
            detail={c}
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

function ApplicantPanel({ detail: c }: { detail: CaseDetail }) {
  const a = c.applicant;
  return (
    <Card title="Applicant" aside="Synthetic persona">
      <KeyValues
        items={[
          { label: "Age", value: a.ageYears },
          { label: "Government ID", value: a.governmentIdMasked, mono: true },
          { label: "Employer", value: a.employer },
          { label: "Employed", value: `${a.employmentMonths} months` },
          {
            label: "WhiteBank customer",
            value: a.relationshipMonths === 0 ? "New to bank" : `${a.relationshipMonths} months`,
          },
          { label: "Monthly income", value: formatPeso(a.monthlyIncome) },
          { label: "Monthly obligations", value: formatPeso(a.monthlyObligations) },
          { label: "Disburse to", value: a.depositAccount, mono: true },
        ]}
      />
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
        <div className={c.recommendation ? "mt-4" : undefined}>
          <KeyValues
            items={[
              { label: "Approved amount", value: formatPeso(c.approved.amount) },
              { label: "Tenor", value: `${c.approved.tenorMonths} months` },
              { label: "Rate", value: formatMonthlyRate(c.approved.monthlyRate) },
              {
                label: "Monthly instalment",
                value:
                  c.approved.regularInstalment === null
                    ? "Unavailable"
                    : formatPeso(c.approved.regularInstalment),
              },
            ]}
          />
          <div className="mt-3">
            <ApprovedTermsNote approved={c.approved} />
          </div>
        </div>
      )}
      {c.decline && (
        <Callout tone="bad" lead={`Declined by ${c.decline.byName}:`} className="mt-4">
          <span className="font-mono text-xs">{c.decline.reasonCode}</span> ·{" "}
          {DECLINE_REASON_LABEL[c.decline.reasonCode]}
          {c.decline.note && ` — ${c.decline.note}`}
        </Callout>
      )}
    </Card>
  );
}

function WithdrawalPanel({ withdrawal: w }: { withdrawal: NonNullable<CaseDetail["withdrawal"]> }) {
  return (
    <Card title="Withdrawal">
      <KeyValues
        items={[
          { label: "Reason", value: WITHDRAW_REASON_LABEL[w.reasonCode] },
          { label: "Withdrawn by", value: `${w.byName} · ${formatDateTime(w.at)}` },
          ...(w.note ? [{ label: "Note", value: `“${w.note}”` }] : []),
        ]}
      />
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
        <Callout tone="bad" alert className="mt-3">
          {formatAmountsInText(b.lastErrorDetail ?? "The last attempt failed.")}
          {b.lastErrorCode && <span className="ml-2 font-mono text-xs">({b.lastErrorCode})</span>}
        </Callout>
      )}
    </Card>
  );
}
