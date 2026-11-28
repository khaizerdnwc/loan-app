import { CaseStatus } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

export interface Window {
  from: Date;
  /** Exclusive. */
  until: Date;
}

export interface KeyCount {
  key: string;
  label?: string;
  count: number;
}

const counts = (rows: { key: string | null; label?: string | null; n: string }[]): KeyCount[] =>
  rows.map((r) => ({
    key: r.key ?? "NONE",
    ...(r.label ? { label: r.label } : {}),
    count: Number(r.n),
  }));

/**
 * Aggregate reads for the reports (PRD RPT-001, RPT-003), all from stored records: decision
 * records and the activity history (both insert-only) and the case table. Counts only: no
 * applicant data leaves this file.
 */
@Injectable()
export class ReportsRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async outcomes(w: Window): Promise<KeyCount[]> {
    return counts(
      await this.ds.query(
        `SELECT outcome AS key, count(*) AS n FROM decision_record
          WHERE created_at >= $1 AND created_at < $2 GROUP BY outcome ORDER BY outcome`,
        [w.from, w.until],
      ),
    );
  }

  async reasonCodes(w: Window): Promise<KeyCount[]> {
    return counts(
      await this.ds.query(
        `SELECT r->>'code' AS key, min(r->>'staff') AS label, count(*) AS n
           FROM decision_record d, jsonb_array_elements(d.reason_codes) r
          WHERE d.created_at >= $1 AND d.created_at < $2
          GROUP BY 1 ORDER BY 2 DESC, 1`,
        [w.from, w.until],
      ),
    );
  }

  async referralTriggers(w: Window): Promise<KeyCount[]> {
    return counts(
      await this.ds.query(
        `SELECT t AS key, count(*) AS n
           FROM decision_record d, jsonb_array_elements_text(d.referral_triggers) t
          WHERE d.created_at >= $1 AND d.created_at < $2
          GROUP BY 1 ORDER BY 2 DESC, 1`,
        [w.from, w.until],
      ),
    );
  }

  /** Recommendations made in the window, from the history (a recommendation is never edited). */
  async recommendations(w: Window): Promise<{ total: number; overrideReasons: KeyCount[] }> {
    const [row] = (await this.ds.query(
      `SELECT count(*) AS n FROM activity_event
        WHERE action IN ('RECOMMENDED', 'RECOMMENDED_WITH_OVERRIDE')
          AND created_at >= $1 AND created_at < $2`,
      [w.from, w.until],
    )) as [{ n: string }];
    const reasons = counts(
      await this.ds.query(
        `SELECT details->>'overrideReason' AS key, count(*) AS n FROM activity_event
          WHERE action = 'RECOMMENDED_WITH_OVERRIDE' AND created_at >= $1 AND created_at < $2
          GROUP BY 1 ORDER BY 2 DESC, 1`,
        [w.from, w.until],
      ),
    );
    return { total: Number(row.n), overrideReasons: reasons };
  }

  /** Applications started in the window and how far each got. */
  async funnel(w: Window): Promise<{
    started: number;
    submitted: number;
    approved: number;
    disbursedCount: number;
    disbursedAmount: string;
  }> {
    const [row] = (await this.ds.query(
      `SELECT count(*) AS started,
              count(*) FILTER (WHERE c.decision_id IS NOT NULL) AS submitted,
              count(*) FILTER (WHERE c.approved_amount IS NOT NULL) AS approved,
              count(*) FILTER (WHERE c.status = $3) AS disbursed_count,
              -- Unbounded numeric: a total can exceed the per-loan numeric(14,2) width.
              COALESCE(sum(la.principal) FILTER (WHERE c.status = $3), 0)::numeric::text
                AS disbursed_amount
         FROM loan_case c LEFT JOIN loan_account la ON la.case_id = c.id
        WHERE c.created_at >= $1 AND c.created_at < $2`,
      [w.from, w.until, CaseStatus.Disbursed],
    )) as [
      {
        started: string;
        submitted: string;
        approved: string;
        disbursed_count: string;
        disbursed_amount: string;
      },
    ];
    return {
      started: Number(row.started),
      submitted: Number(row.submitted),
      approved: Number(row.approved),
      disbursedCount: Number(row.disbursed_count),
      disbursedAmount: row.disbursed_amount,
    };
  }

  async statuses(w: Window): Promise<KeyCount[]> {
    return counts(
      await this.ds.query(
        `SELECT status AS key, count(*) AS n FROM loan_case
          WHERE created_at >= $1 AND created_at < $2 GROUP BY status ORDER BY 2 DESC, 1`,
        [w.from, w.until],
      ),
    );
  }
}
