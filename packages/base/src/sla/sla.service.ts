import {
  type CaseSlaView,
  type CaseStatus,
  SlaState,
  type SlaView,
  type TurnaroundReport,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { SessionUser } from "../auth/session";
import { CasesService } from "../cases/cases.service";
import { reportPeriod } from "../reports/period";
import { BUSINESS_DAY } from "./business-time";
import { SlaRepository } from "./sla.repository";
import { slaFor, stageVisits, turnaround } from "./sla-clock";
import { SLA_POLICY } from "./sla-policy";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Stage SLAs (PRD WF-003) and turnaround (PRD RPT-002), measured in Philippine business time
 * from the activity history (when a case entered its stage), read-only: no transaction, no
 * writes. Case visibility is the case list's own (CasesService), so a role sees clocks only
 * for cases it can see.
 */
@Injectable()
export class SlaService {
  constructor(
    private readonly repo: SlaRepository,
    private readonly cases: CasesService,
  ) {}

  private async holidaySet(): Promise<Set<string>> {
    return new Set((await this.repo.holidays()).map((h) => h.date));
  }

  /** Clocks for cases (only those in a stage with an SLA come back). */
  async forCases(
    cases: { id: string; status: CaseStatus }[],
    now = new Date(),
  ): Promise<SlaView[]> {
    const timed = cases.filter((c) => SLA_POLICY[c.status]);
    const [entries, holidays] = await Promise.all([
      this.repo.stageEntries(timed),
      this.holidaySet(),
    ]);
    return timed.flatMap((c) => {
      const view = slaFor(c.id, c.status, entries.get(c.id) ?? null, now, holidays);
      return view ? [view] : [];
    });
  }

  async list(user: SessionUser, view: "queue" | "all"): Promise<SlaView[]> {
    const { items } = await this.cases.list(user, view);
    return this.forCases(items);
  }

  /** One case's clock (null when its stage has none; 404 outside the role's view). */
  async forCase(user: SessionUser, id: string): Promise<CaseSlaView> {
    const c = await this.cases.visible(user, id);
    const [[view], holidays] = await Promise.all([
      this.forCases([{ id: c.id, status: c.status }]),
      this.repo.holidays(),
    ]);
    return { sla: view ?? null, holidayCalendarEnds: holidays.at(-1)?.date ?? null };
  }

  async turnaround(from?: string, to?: string, now = new Date()): Promise<TurnaroundReport> {
    const { period, window } = reportPeriod(from, to, now);
    const [events, holidays, open] = await Promise.all([
      this.repo.statusEvents(window.from, window.until),
      this.repo.holidays(),
      this.repo.casesIn(Object.keys(SLA_POLICY) as CaseStatus[]),
    ]);
    const all = new Set(holidays.map((h) => h.date));
    const clocks = await this.forCases(open, now);
    return {
      period,
      stages: turnaround(stageVisits(events), window.from, window.until, all),
      openNow: {
        onTrack: clocks.filter((c) => c.state === SlaState.OnTrack).length,
        atRisk: clocks.filter((c) => c.state === SlaState.AtRisk).length,
        breached: clocks.filter((c) => c.state === SlaState.Breached).length,
      },
      businessDay: { start: hh(BUSINESS_DAY.startHour), end: hh(BUSINESS_DAY.endHour) },
      holidays: holidays
        .filter((h) => h.date >= period.from && h.date <= period.to)
        .map((h) => ({ date: h.date, name: h.name })),
      holidayCalendarEnds: holidays.at(-1)?.date ?? null,
    };
  }
}
