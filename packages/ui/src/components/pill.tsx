import type { CaseStatus, DecisionOutcome } from "@loan/core";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-100 text-ok-700",
  warn: "bg-gold-100 text-gold-700",
  bad: "bg-bad-100 text-bad-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-mist-100 text-mist-600",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

const STATUS: Record<CaseStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  REVIEW: { label: "In review", tone: "warn" },
  APPROVAL: { label: "Awaiting approval", tone: "warn" },
  OFFER: { label: "Offer · awaiting signature", tone: "info" },
  BOOKING: { label: "Ready to book", tone: "info" },
  PENDING_CHECKER: { label: "Awaiting checker", tone: "warn" },
  BOOKING_FAILED: { label: "Booking failed", tone: "bad" },
  DISBURSED: { label: "Disbursed", tone: "ok" },
  DECLINED: { label: "Declined", tone: "bad" },
};

/** The case stage, in the one wording and colour used everywhere. */
export function StagePill({ status }: { status: CaseStatus }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

const OUTCOME: Record<DecisionOutcome, { label: string; tone: Tone }> = {
  AUTO_APPROVE: { label: "Auto-approve", tone: "ok" },
  REFER: { label: "Refer", tone: "warn" },
  AUTO_DECLINE: { label: "Auto-decline", tone: "bad" },
};

/** The automated outcome. */
export function OutcomePill({ outcome }: { outcome: DecisionOutcome | null }) {
  if (!outcome) return <Pill>Not decided</Pill>;
  const o = OUTCOME[outcome];
  return <Pill tone={o.tone}>{o.label}</Pill>;
}

export const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  AUTO_APPROVE: "Auto-approve",
  REFER: "Refer",
  AUTO_DECLINE: "Auto-decline",
};
