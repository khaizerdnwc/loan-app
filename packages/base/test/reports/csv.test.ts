import type { DecisionMixReport, OriginationFunnelReport, TurnaroundReport } from "@loan/core";
import { csvCell, decisionMixRows, funnelRows, toCsv, turnaroundRows } from "../../src/reports/csv";

const period = { from: "2026-11-01", to: "2026-11-30" };

describe("report CSV cells (RPT-006)", () => {
  it.each([
    ["plain text", "Home improvement", "Home improvement"],
    ["a comma is quoted", "Thin file, low score", '"Thin file, low score"'],
    ["a quote is doubled inside quotes", 'Said "no"', '"Said ""no"""'],
    ["a line break is quoted", "line one\nline two", '"line one\nline two"'],
    ["an empty cell", null, ""],
    ["a count", 12, "12"],
    ["a decimal share", "0.6400", "0.6400"],
    ["a negative decimal stays a number", "-125.50", "-125.50"],
  ])("%s", (_name, value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it.each([
    ['=HYPERLINK("http://x")', '"\'=HYPERLINK(""http://x"")"'],
    ["+SUM(A1:A2)", "'+SUM(A1:A2)"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["\tTAB", "'\tTAB"],
    ["\rCR", '"\'\rCR"'],
    ["-", "'-"],
  ])("a cell a spreadsheet would run as a formula (%j) is kept as text", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it("a file is BOM-prefixed UTF-8 text with CRLF line ends", () => {
    expect(
      toCsv([
        ["a", "b"],
        [1, null],
      ]),
    ).toBe("﻿a,b\r\n1,\r\n");
  });
});

describe("each report as rows: the same figures as the screen", () => {
  it("the funnel: stages with conversion, the amount disbursed, where they are now", () => {
    const r: OriginationFunnelReport = {
      period,
      stages: [
        { key: "STARTED", count: 10, conversion: "1.0000" },
        { key: "SUBMITTED", count: 8, conversion: "0.8000" },
        { key: "APPROVED", count: 5, conversion: "0.6250" },
        { key: "DISBURSED", count: 3, conversion: "0.6000" },
      ],
      disbursedAmount: "270000.00",
      byStatus: [{ key: "DISBURSED", count: 3, share: "0.3000" }],
    };
    expect(toCsv(funnelRows(r))).toBe(
      [
        "﻿Report,Origination funnel",
        "From,2026-11-01",
        "To,2026-11-30",
        "",
        "Stage,Count,Conversion",
        "STARTED,10,1.0000",
        "SUBMITTED,8,0.8000",
        "APPROVED,5,0.6250",
        "DISBURSED,3,0.6000",
        "",
        "Disbursed amount (PHP),270000.00",
        "",
        "Status now,Label,Count,Share",
        "DISBURSED,,3,0.3000",
        "",
      ].join("\r\n"),
    );
  });

  it("the decision mix: rates, then each count table with its label", () => {
    const r: DecisionMixReport = {
      period,
      decisions: 4,
      outcomes: [{ key: "REFER", count: 2, share: "0.5000" }],
      straightThroughRate: "0.5000",
      reasonCodes: [
        { key: "R04", label: "Thin bureau file, needs review", count: 1, share: "0.2500" },
      ],
      referralTriggers: [],
      recommendations: 2,
      overrides: 1,
      overrideRate: "0.5000",
      overrideReasons: [{ key: "OV04", count: 1, share: "1.0000" }],
    };
    const lines = toCsv(decisionMixRows(r)).split("\r\n");
    expect(lines).toContain("Straight-through rate,0.5000");
    expect(lines).toContain("Override rate,0.5000");
    expect(lines).toContain('R04,"Thin bureau file, needs review",1,0.2500');
    expect(lines).toContain("Referral trigger,Label,Count,Share");
    expect(lines).toContain("OV04,,1,1.0000");
  });

  it("the turnaround: business minutes per stage (empty where not measured), open cases, holidays", () => {
    const r: TurnaroundReport = {
      period,
      stages: [
        {
          status: "REVIEW",
          visits: 3,
          medianMinutes: 120,
          p90Minutes: 400,
          targetMinutes: 480,
          withinTarget: 3,
          withinTargetShare: "1.0000",
        },
        {
          status: "OFFER",
          visits: 0,
          medianMinutes: null,
          p90Minutes: null,
          targetMinutes: null,
          withinTarget: 0,
          withinTargetShare: null,
        },
      ],
      openNow: { onTrack: 2, atRisk: 1, breached: 4 },
      businessDay: { start: "09:00", end: "17:00" },
      holidays: [{ date: "2026-11-30", name: "Bonifacio Day" }],
      holidayCalendarEnds: "2027-06-12",
    };
    const lines = toCsv(turnaroundRows(r)).split("\r\n");
    expect(lines).toContain("Business day,09:00-17:00 Manila");
    expect(lines).toContain("REVIEW,In review,3,120,400,480,3,1.0000");
    expect(lines).toContain("OFFER,Offer · awaiting signature,0,,,,0,");
    expect(lines).toContain("Past SLA,4");
    expect(lines).toContain("2026-11-30,Bonifacio Day");
  });
});
