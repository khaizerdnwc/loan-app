import {
  addBusinessMinutes,
  businessMinutesBetween,
  manilaDate,
} from "../../src/sla/business-time";
import type { StatusEvent } from "../../src/sla/sla.repository";
import { slaFor, stageVisits, turnaround } from "../../src/sla/sla-clock";

/** A Manila wall-clock time as an instant. */
const at = (local: string) => new Date(`${local}:00.000+08:00`);
const NONE = new Set<string>();
// 2026-11-27 is a Friday, 2026-11-30 a Monday (Bonifacio Day), 2026-12-01 a Tuesday.
const BONIFACIO = new Set(["2026-11-30"]);

describe("Philippine business time (PRD PLT-005)", () => {
  it.each([
    ["within one business day", "2026-12-01T10:00", "2026-12-01T12:00", NONE, 120],
    ["across the night", "2026-12-01T16:00", "2026-12-02T10:00", NONE, 120],
    [
      "before opening and after closing count nothing",
      "2026-12-01T07:00",
      "2026-12-01T09:30",
      NONE,
      30,
    ],
    ["after closing", "2026-12-01T16:30", "2026-12-01T22:00", NONE, 30],
    ["over a weekend", "2026-11-27T16:00", "2026-11-30T10:00", NONE, 120],
    ["over a weekend and a holiday", "2026-11-27T16:00", "2026-12-01T10:00", BONIFACIO, 120],
    ["a whole holiday counts nothing", "2026-11-30T08:00", "2026-11-30T18:00", BONIFACIO, 0],
    ["backwards is zero", "2026-12-01T12:00", "2026-12-01T10:00", NONE, 0],
  ])("%s", (_name, from, to, holidays, minutes) => {
    expect(businessMinutesBetween(at(from), at(to), holidays)).toBe(minutes);
  });

  it("a target falls due in business time, skipping nights, weekends and holidays", () => {
    expect(addBusinessMinutes(at("2026-12-01T10:00"), 120, NONE)).toEqual(at("2026-12-01T12:00"));
    expect(addBusinessMinutes(at("2026-11-27T16:00"), 120, BONIFACIO)).toEqual(
      at("2026-12-01T10:00"),
    );
    // Entered in the evening: the clock starts at the next opening.
    expect(addBusinessMinutes(at("2026-12-01T20:00"), 480, NONE)).toEqual(at("2026-12-02T17:00"));
    expect(addBusinessMinutes(at("2026-12-01T20:00"), 0, NONE)).toEqual(at("2026-12-02T09:00"));
  });

  it("the Manila date turns at 16:00 UTC", () => {
    expect(manilaDate(new Date("2026-11-28T15:59:59.999Z"))).toBe("2026-11-28");
    expect(manilaDate(new Date("2026-11-28T16:00:00.000Z"))).toBe("2026-11-29");
  });
});

describe("stage SLAs (PRD WF-003)", () => {
  const entered = at("2026-12-01T09:00");

  it.each([
    ["2026-12-01T14:00", "ON_TRACK", 180],
    ["2026-12-01T15:00", "AT_RISK", 120],
    ["2026-12-01T17:00", "AT_RISK", 0],
    ["2026-12-02T10:00", "BREACHED", -60],
  ])("review (8 business hours) at %s is %s with %i minutes left", (now, state, remaining) => {
    expect(slaFor("c1", "REVIEW", entered, at(now), NONE)).toMatchObject({
      state,
      remainingMinutes: remaining,
      targetMinutes: 480,
      owner: "Loan officer",
      dueAt: at("2026-12-01T17:00").toISOString(),
    });
  });

  it.each([
    ["REVIEW", 480, "Loan officer"],
    ["APPROVAL", 240, "Approver"],
    ["BOOKING", 240, "Loan operations"],
    ["PENDING_CHECKER", 240, "Loan operations supervisor"],
    ["BOOKING_FAILED", 240, "Loan operations supervisor"],
  ] as const)("%s has a %i-minute business clock owned by %s", (status, minutes, owner) => {
    expect(slaFor("c1", status, entered, entered, NONE)).toMatchObject({
      targetMinutes: minutes,
      owner,
      state: "ON_TRACK",
    });
  });

  it("stages without a target, and a case with no stage entry, have no clock", () => {
    for (const status of [
      "DRAFT",
      "INFO_REQUESTED",
      "OFFER",
      "DISBURSED",
      "DECLINED",
      "WITHDRAWN",
      "EXPIRED",
    ] as const) {
      expect(slaFor("c1", status, entered, entered, NONE)).toBeNull();
    }
    expect(slaFor("c1", "REVIEW", null, entered, NONE)).toBeNull();
  });
});

describe("turnaround (PRD RPT-002)", () => {
  const ev = (caseId: string, toStatus: StatusEvent["toStatus"], local: string): StatusEvent => ({
    caseId,
    toStatus,
    at: at(local),
  });

  it("rebuilds stage visits per case and reports median, p90 and within-target", () => {
    const events = [
      ev("a", "REVIEW", "2026-12-01T09:00"),
      ev("a", "APPROVAL", "2026-12-01T11:00"), // review 120
      ev("a", "OFFER", "2026-12-01T12:00"), // approval 60
      ev("b", "REVIEW", "2026-12-01T09:00"),
      ev("b", "INFO_REQUESTED", "2026-12-02T13:00"), // review 720 (breached)
      ev("b", "REVIEW", "2026-12-03T09:00"),
      ev("b", "APPROVAL", "2026-12-03T10:00"), // review 60
    ];
    const visits = stageVisits(events);
    expect(visits).toHaveLength(5);
    const stages = turnaround(visits, at("2026-12-01T00:00"), at("2026-12-04T00:00"), NONE);
    expect(stages.find((s) => s.status === "REVIEW")).toEqual({
      status: "REVIEW",
      visits: 3,
      medianMinutes: 120,
      p90Minutes: 720,
      targetMinutes: 480,
      withinTarget: 2,
      withinTargetShare: "0.6667",
    });
    expect(stages.find((s) => s.status === "APPROVAL")).toMatchObject({
      visits: 1,
      medianMinutes: 60,
      withinTargetShare: "1.0000",
    });
    expect(stages.find((s) => s.status === "BOOKING")).toMatchObject({
      visits: 0,
      medianMinutes: null,
      withinTargetShare: null,
    });
  });

  it("counts only visits that ended in the period", () => {
    const visits = stageVisits([
      ev("a", "REVIEW", "2026-11-25T09:00"),
      ev("a", "APPROVAL", "2026-11-25T10:00"),
      ev("a", "OFFER", "2026-12-01T10:00"),
    ]);
    const stages = turnaround(visits, at("2026-12-01T00:00"), at("2026-12-02T00:00"), NONE);
    expect(stages.find((s) => s.status === "REVIEW")?.visits).toBe(0);
    expect(stages.find((s) => s.status === "APPROVAL")?.visits).toBe(1);
  });
});
