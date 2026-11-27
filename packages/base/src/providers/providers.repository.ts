import type { ProviderMode, ServiceName } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, MoreThanOrEqual } from "typeorm";
import { BureauReportCacheEntity, ProviderCallEntity } from "./providers.entities";

export interface UsageRow {
  service: ServiceName;
  outcome: string;
  n: number;
  cost: string;
}

/**
 * SQL for the provider gateway. Provider calls happen before the decision's transaction (no
 * row lock is held while a provider answers), so these writes use their own statements.
 */
@Injectable()
export class ProvidersRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async recordCall(call: Partial<ProviderCallEntity>): Promise<void> {
    const repo = this.ds.getRepository(ProviderCallEntity);
    await repo.insert(repo.create(call));
  }

  /** The applicant's report from a provider in this mode, if pulled since `since`. */
  cachedReport(
    applicantId: string,
    mode: ProviderMode,
    since: Date,
  ): Promise<BureauReportCacheEntity | null> {
    return this.ds.getRepository(BureauReportCacheEntity).findOne({
      where: { applicantId, mode, retrievedAt: MoreThanOrEqual(since) },
    });
  }

  async cacheReport(row: BureauReportCacheEntity): Promise<void> {
    // A single upsert lets two pulls for one applicant land at once without a key clash, and
    // keeps whichever report is newer.
    await this.ds.query(
      `INSERT INTO bureau_report_cache (applicant_id, mode, report, retrieved_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (applicant_id, mode) DO UPDATE
         SET report = EXCLUDED.report, retrieved_at = EXCLUDED.retrieved_at
         WHERE bureau_report_cache.retrieved_at < EXCLUDED.retrieved_at`,
      [row.applicantId, row.mode, JSON.stringify(row.report), row.retrievedAt],
    );
  }

  /** Calls, attempts and cost per service and outcome since a time. */
  async usage(since: Date): Promise<UsageRow[]> {
    const rows: { service: ServiceName; outcome: string; n: string; cost: string }[] =
      await this.ds.query(
        `SELECT service, outcome, count(*) AS n, COALESCE(sum(cost), 0)::numeric(14,2)::text AS cost
         FROM provider_call WHERE created_at >= $1 GROUP BY service, outcome ORDER BY service, outcome`,
        [since],
      );
    return rows.map((r) => ({
      service: r.service,
      outcome: r.outcome,
      n: Number(r.n),
      cost: r.cost,
    }));
  }

  /** Percentiles of decision latency since a time, over records that carry one. */
  async latency(
    since: Date,
  ): Promise<{ n: number; p50: number | null; p95: number | null; max: number | null }> {
    const [row] = (await this.ds.query(
      `SELECT count(latency_ms) AS n,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
              percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
              max(latency_ms) AS max
       FROM decision_record WHERE created_at >= $1 AND latency_ms IS NOT NULL`,
      [since],
    )) as { n: string; p50: number | null; p95: number | null; max: number | null }[];
    return {
      n: Number(row?.n ?? 0),
      p50: row?.p50 ?? null,
      p95: row?.p95 ?? null,
      max: row?.max ?? null,
    };
  }
}
