"use client";

import {
  type CaseSlaView,
  type CaseStatus,
  SLA_STATE_LABEL,
  type SlaState,
  type SlaView,
} from "@loan/core";
import { Callout, formatDate, formatDateTime, Pill, type Tone } from "@loan/ui";
import { useEffect, useRef } from "react";
import { useApi } from "@/lib/use-api";

const TONE: Record<SlaState, Tone> = { ON_TRACK: "ok", AT_RISK: "warn", BREACHED: "bad" };

/** Business minutes as "6h 20m" (whole minutes). */
export function businessDuration(minutes: number): string {
  const m = Math.abs(minutes);
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "6h 20m left" or "2h 5m over", in business time. */
export function timeLeft(s: SlaView): string {
  return s.remainingMinutes < 0
    ? `${businessDuration(s.remainingMinutes)} over`
    : `${businessDuration(s.remainingMinutes)} left`;
}

/** The one line a list shows when its clocks could not be read (the list itself is complete). */
export function SlaUnavailable({ what }: { what: "queue" | "list" }) {
  return (
    <div role="status" className="mb-3">
      <Callout tone="neutral" lead="SLA clocks could not be loaded just now.">
        The {what} is complete but shows no SLA. Reload to try again.
      </Callout>
    </div>
  );
}

/**
 * The holiday calendar's reach: a note when no calendar is loaded, or when `onOrAfter` (a
 * business date) runs past its last date; null while the calendar covers it.
 */
export function calendarNote(ends: string | null, onOrAfter: string): string | null {
  if (!ends) return "No holiday calendar is loaded: no holiday is skipped.";
  if (onOrAfter <= ends) return null;
  return `The holiday calendar ends ${formatDate(ends)}: after that no holiday is skipped.`;
}

/** The SLA state of a case's stage in one pill: on track, at risk or past SLA, with time. */
export function SlaPill({ sla }: { sla: SlaView }) {
  return (
    <Pill tone={TONE[sla.state]}>
      {SLA_STATE_LABEL[sla.state]} · {timeLeft(sla)}
    </Pill>
  );
}

/**
 * The case page's clock (PRD WF-003): who acts next and by when, in business time. Renders
 * nothing for a stage without an SLA (draft, information requested, offer, closed), and a
 * muted line when the clock cannot be read (the rest of the case page does not depend on it).
 */
export function CaseSla({ caseId, status }: { caseId: string; status: CaseStatus }) {
  const data = useApi<CaseSlaView>(`/sla/cases/${caseId}`);
  const reload = data.reload;
  const seen = useRef(status);
  // The case moved to another stage: read its new clock.
  useEffect(() => {
    if (seen.current === status) return;
    seen.current = status;
    void reload();
  }, [status, reload]);
  if (data.error) {
    return (
      <span className="text-xs text-mist-500">
        SLA clock unavailable just now; the rest of the case is unaffected.
      </span>
    );
  }
  const sla = data.data?.sla;
  if (!sla || sla.status !== status) return null;
  const note = calendarNote(data.data?.holidayCalendarEnds ?? null, sla.dueAt.slice(0, 10));
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-mist-500">
      <SlaPill sla={sla} />
      <span>
        {sla.owner} · due {formatDateTime(sla.dueAt)} (business hours)
      </span>
      {note && <span>{note}</span>}
    </span>
  );
}
