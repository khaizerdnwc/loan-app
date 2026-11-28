import {
  type DecisionMixReport,
  type OriginationFunnelReport,
  type ReportCount,
  STATUS_LABEL,
  type TurnaroundReport,
} from "@loan/core";

/**
 * Report downloads as CSV (PRD RPT-006, downloads only): the same figures the report screens
 * show, computed by the same services, so a file always matches its report. Counts and
 * decimal strings only, never applicant data. Pure: no Nest, no I/O.
 */

export type CsvRow = (string | number | null)[];

/** A plain number (count, decimal amount or share) is left as it is, sign and all. */
const isPlainNumber = (text: string): boolean =>
  /^[-\d.]+$/.test(text) && Number.isFinite(Number(text));
/**
 * Characters that make a spreadsheet read a cell as a formula (or a DDE call) when it opens
 * the file: =, +, -, @, and a leading tab or carriage return. Such a text cell is prefixed
 * with an apostrophe so it stays text (OWASP CSV injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: formula-guarded, then quoted (RFC 4180) when it holds a comma, quote or line break. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value !== "number" && !isPlainNumber(text) && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The whole file: CRLF line ends (RFC 4180), and a UTF-8 byte order mark so a spreadsheet
 * opens accented reason wording correctly.
 */
export function toCsv(rows: CsvRow[]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const counts = (heading: string, rows: ReportCount[]): CsvRow[] => [
  [],
  [heading, "Label", "Count", "Share"],
  ...rows.map((r) => [r.key, r.label ?? "", r.count, r.share]),
];

const header = (title: string, period: { from: string; to: string }): CsvRow[] => [
  ["Report", title],
  ["From", period.from],
  ["To", period.to],
];

/** RPT-001 as rows: the stages with their conversion, the amount disbursed, and where they are now. */
export function funnelRows(r: OriginationFunnelReport): CsvRow[] {
  return [
    ...header("Origination funnel", r.period),
    [],
    ["Stage", "Count", "Conversion"],
    ...r.stages.map((s) => [s.key, s.count, s.conversion]),
    [],
    ["Disbursed amount (PHP)", r.disbursedAmount],
    ...counts("Status now", r.byStatus),
  ];
}

/** RPT-003 as rows: the outcome mix and rates, reason codes, referral triggers and overrides. */
export function decisionMixRows(r: DecisionMixReport): CsvRow[] {
  return [
    ...header("Decision mix", r.period),
    [],
    ["Decisions", r.decisions],
    ["Straight-through rate", r.straightThroughRate],
    ["Recommendations", r.recommendations],
    ["Overrides", r.overrides],
    ["Override rate", r.overrideRate],
    ...counts("Outcome", r.outcomes),
    ...counts("Reason code", r.reasonCodes),
    ...counts("Referral trigger", r.referralTriggers),
    ...counts("Override reason", r.overrideReasons),
  ];
}

/** RPT-002 as rows: business minutes per stage, and the open cases by SLA state. */
export function turnaroundRows(r: TurnaroundReport): CsvRow[] {
  return [
    ...header("Turnaround and SLA", r.period),
    ["Business day", `${r.businessDay.start}-${r.businessDay.end} Manila`],
    [],
    [
      "Stage",
      "Label",
      "Visits",
      "Median business minutes",
      "90th percentile business minutes",
      "SLA business minutes",
      "Within SLA",
      "Share within SLA",
    ],
    ...r.stages.map((s) => [
      s.status,
      STATUS_LABEL[s.status],
      s.visits,
      s.medianMinutes,
      s.p90Minutes,
      s.targetMinutes,
      s.withinTarget,
      s.withinTargetShare,
    ]),
    [],
    ["Open now", "Count"],
    ["On track", r.openNow.onTrack],
    ["At risk", r.openNow.atRisk],
    ["Past SLA", r.openNow.breached],
    [],
    ["Holiday", "Name"],
    ...r.holidays.map((h) => [h.date, h.name]),
  ];
}
