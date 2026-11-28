import type { CaseStatus } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { BusinessHolidayEntity } from "./entities/business-holiday.entity";

/** A status change from the activity history (insert-only, so it is a fact, not a clock). */
export interface StatusEvent {
  caseId: string;
  toStatus: CaseStatus;
  at: Date;
}

/**
 * Reads for SLAs and turnaround. Stage times come from `activity_event` (insert-only), never
 * from `loan_case.updated_at`, which any edit moves.
 */
@Injectable()
export class SlaRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Every case now in one of these statuses (the open cases that carry an SLA). */
  async casesIn(statuses: CaseStatus[]): Promise<{ id: string; status: CaseStatus }[]> {
    if (statuses.length === 0) return [];
    return this.ds.query(
      "SELECT id, status FROM loan_case WHERE status = ANY($1::text[]) ORDER BY id",
      [statuses],
    );
  }

  async holidays(): Promise<BusinessHolidayEntity[]> {
    return this.ds.getRepository(BusinessHolidayEntity).find({ order: { date: "ASC" } });
  }

  /** For each case, when it last entered its current status (the latest event into it). */
  async stageEntries(cases: { id: string; status: CaseStatus }[]): Promise<Map<string, Date>> {
    if (cases.length === 0) return new Map();
    const rows: { case_id: string; entered_at: Date }[] = await this.ds.query(
      `SELECT e.case_id, max(e.created_at) AS entered_at
         FROM activity_event e
         JOIN unnest($1::uuid[], $2::text[]) AS c(id, status)
           ON c.id = e.case_id AND e.to_status = c.status
        GROUP BY e.case_id`,
      [cases.map((c) => c.id), cases.map((c) => c.status)],
    );
    return new Map(rows.map((r) => [r.case_id, new Date(r.entered_at)]));
  }

  /**
   * Every status change before `until` of the cases that changed status in [from, until),
   * oldest first: enough to rebuild each stage visit that ended in the window.
   */
  async statusEvents(from: Date, until: Date): Promise<StatusEvent[]> {
    const rows: { case_id: string; to_status: CaseStatus; created_at: Date }[] =
      await this.ds.query(
        `SELECT e.case_id, e.to_status, e.created_at
           FROM activity_event e
          WHERE e.to_status IS NOT NULL AND e.created_at < $2
            AND e.case_id IN (SELECT case_id FROM activity_event
                               WHERE to_status IS NOT NULL
                                 AND created_at >= $1 AND created_at < $2)
          ORDER BY e.case_id, e.created_at, e.id`,
        [from, until],
      );
    return rows.map((r) => ({
      caseId: r.case_id,
      toStatus: r.to_status,
      at: new Date(r.created_at),
    }));
  }
}
