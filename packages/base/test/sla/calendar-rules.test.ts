import { HolidayChangeAction } from "@loan/core";
import {
  calendarRefusal,
  isCalendarDate,
  isWeekend,
  wordedDate,
} from "../../src/sla/calendar-rules";

// 2026-12-28 is a Monday; 2027-01-02 a Saturday, 2027-01-03 a Sunday.
const TODAY = "2026-12-01";
const add = (date: string, existing: { name: string } | null = null) =>
  calendarRefusal({ action: HolidayChangeAction.Add, date, today: TODAY, existing });
const remove = (date: string, existing: { name: string } | null = null) =>
  calendarRefusal({ action: HolidayChangeAction.Remove, date, today: TODAY, existing });

describe("HC-1 business calendar change rules (PRD PLT-005)", () => {
  it.each([
    ["2027-01-04", true],
    ["2028-02-29", true],
    ["2027-02-29", false],
    ["2027-13-01", false],
    ["2027-1-04", false],
    ["04/01/2027", false],
    ["", false],
  ])("isCalendarDate(%j) is %s", (date, ok) => {
    expect(isCalendarDate(date)).toBe(ok);
  });

  it("words a date as the screens do", () => {
    expect(wordedDate("2027-01-04")).toBe("4 Jan 2027");
    expect(wordedDate("2026-12-25")).toBe("25 Dec 2026");
  });

  it("knows Saturdays and Sundays", () => {
    expect(isWeekend("2027-01-02")).toBe(true);
    expect(isWeekend("2027-01-03")).toBe(true);
    expect(isWeekend("2026-12-28")).toBe(false);
  });

  it("adds a weekday after today that is not already a holiday", () => {
    expect(add("2026-12-28")).toBeNull();
  });

  it("refuses today and earlier days, which were already measured", () => {
    for (const date of [TODAY, "2026-11-30", "2025-12-28"]) {
      expect(add(date)).toMatchObject({ kind: "field", field: "date" });
      expect(remove(date, { name: "Bonifacio Day" })).toMatchObject({
        kind: "field",
        field: "date",
      });
    }
    expect(add("2026-12-02")).toBeNull();
  });

  it("refuses adding a weekend day (already outside business time) or an existing holiday", () => {
    expect(add("2027-01-02")).toMatchObject({ kind: "field", field: "date" });
    expect(add("2026-12-28", { name: "Typhoon suspension" })).toEqual({
      kind: "state",
      message: "28 Dec 2026 is already a holiday (Typhoon suspension).",
    });
  });

  it("removes only a holiday that is in the calendar", () => {
    expect(remove("2026-12-28")).toEqual({
      kind: "state",
      message: "28 Dec 2026 is not a holiday in the calendar.",
    });
    expect(remove("2026-12-28", { name: "Typhoon suspension" })).toBeNull();
  });

  it("refuses a date that is not a real one before anything else", () => {
    expect(add("2027-02-30")).toMatchObject({ kind: "field", field: "date" });
  });
});
