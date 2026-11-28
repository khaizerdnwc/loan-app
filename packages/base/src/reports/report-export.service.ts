import { Injectable, StreamableFile } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { type CsvRow, toCsv } from "./csv";

/** The reports that download as CSV, with the words the audit log and the file name use. */
export const REPORT_FILES = {
  FUNNEL: { name: "origination-funnel", title: "origination funnel" },
  DECISION_MIX: { name: "decision-mix", title: "decision mix" },
  TURNAROUND: { name: "turnaround-sla", title: "turnaround and SLA report" },
} as const;
export type ReportFile = keyof typeof REPORT_FILES;

/**
 * Hands a report over as a CSV file (PRD RPT-006, downloads only), and records who took it in
 * the audit log first: the entry commits before any byte of the file is sent, so a download
 * the log cannot record is refused (500), never handed out unrecorded. The file holds counts
 * only; the entry names the report and its period, never figures.
 */
@Injectable()
export class ReportExportService {
  constructor(private readonly audit: AuditService) {}

  async download(
    user: SessionUser,
    report: ReportFile,
    period: { from: string; to: string },
    rows: CsvRow[],
  ): Promise<StreamableFile> {
    const file = REPORT_FILES[report];
    const fileName = `${file.name}-${period.from}-to-${period.to}.csv`;
    await this.audit.record({
      actor: user,
      action: "REPORT_EXPORTED",
      summary: `Downloaded the ${file.title} for ${period.from} to ${period.to} as CSV.`,
      details: { report, from: period.from, to: period.to, fileName },
    });
    return new StreamableFile(Buffer.from(toCsv(rows), "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
