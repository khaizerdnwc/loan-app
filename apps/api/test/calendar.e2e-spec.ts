import { SEED_HOLIDAYS, seed } from "@loan/base";
import type { BusinessCalendarView, HolidayView, SlaView } from "@loan/core";
import { count, type Harness, resetCalendar, startHarness, submitCase } from "./support/harness";

/**
 * The business calendar kept from a screen (PRD PLT-005): two administrators add or remove a
 * future holiday, and the business clock (stage SLAs) follows the calendar (HC-2..HC-6, HC-8).
 * HC-1 is the rules' unit test (packages/base/test/sla/calendar-rules.test.ts).
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await resetCalendar(h.ds);
});

const DAY_MS = 86_400_000;
const PH_MS = 8 * 3_600_000;
const SEEDED = new Set(SEED_HOLIDAYS.map((d) => d.date));

/** Today's Manila date, plus `days`. */
const manilaDay = (days = 0) =>
  new Date(Date.now() + PH_MS + days * DAY_MS).toISOString().slice(0, 10);
/** The Manila date of an ISO instant. */
const manilaDateOf = (iso: string) => new Date(Date.parse(iso) + PH_MS).toISOString().slice(0, 10);
/** A YYYY-MM-DD date as the API words it in a refusal: "4 Jan 2027". */
const worded = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d} ${month[(m ?? 1) - 1]} ${y}`;
};
const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6;

/** The `nth` weekday after today that is not a seeded holiday (n from 1). */
function futureWorkday(nth = 1): string {
  let found = 0;
  for (let d = 1; ; d++) {
    const date = manilaDay(d);
    if (!isWeekend(date) && !SEEDED.has(date) && ++found === nth) return date;
  }
}
/** The first Saturday after today. */
function futureSaturday(): string {
  for (let d = 1; ; d++) if (weekday(manilaDay(d)) === 6) return manilaDay(d);
}

const holidays = async () =>
  (await h.as("diane").get("/calendar/holidays").expect(200)).body as HolidayView[];
const calendar = async (persona: "leo" | "celia" = "leo") =>
  (await h.as(persona).get("/calendar").expect(200)).body as BusinessCalendarView;
const audits = (action: string) =>
  count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE action = $1", [action]);
const changes = () => count(h.ds, "SELECT count(*) AS n FROM business_holiday_change");
const pendingCount = () =>
  count(h.ds, "SELECT count(*) AS n FROM business_holiday_change WHERE status = 'PENDING'");

/** Leo drafts a change; returns its id. */
async function draft(body: { date: string } & Record<string, string>): Promise<string> {
  const view = (await h.as("leo").post("/calendar/changes", body).expect(201))
    .body as BusinessCalendarView;
  return view.pending.find((c) => c.date === body.date)?.id as string;
}

describe("HC-2 reading the calendar", () => {
  it("every signed-in role reads the holidays; only administrators see and make changes", async () => {
    for (const persona of ["paolo", "rina", "marco", "diane", "leo"] as const) {
      const list = (await h.as(persona).get("/calendar/holidays").expect(200)).body;
      expect(list).toEqual(SEED_HOLIDAYS);
    }
    expect(await calendar()).toEqual({ today: manilaDay(), holidays: SEED_HOLIDAYS, pending: [] });
    for (const persona of ["paolo", "diane", "marco"] as const) {
      expect((await h.as(persona).get("/calendar").expect(403)).body.code).toBe("FORBIDDEN_ROLE");
      await h
        .as(persona)
        .post("/calendar/changes", {
          action: "ADD",
          date: futureWorkday(),
          name: "Typhoon suspension",
          reason: "Declared",
        })
        .expect(403);
    }
    await h.anonymous().get("/calendar/holidays").expect(401);
    await h.anonymous().get("/calendar").expect(401);
    expect(await changes()).toBe(0);
  });
});

describe("HC-3 maker-checker on a change", () => {
  it("an added holiday waits for a second administrator; the drafter cannot approve it; each step is audited", async () => {
    const date = futureWorkday();
    const requested = await audits("HOLIDAY_CHANGE_REQUESTED");
    const added = await audits("HOLIDAY_ADDED");
    const view = (
      await h
        .as("leo")
        .post("/calendar/changes", {
          action: "ADD",
          date,
          name: "  Typhoon suspension ",
          reason: "Declared by the Palace",
        })
        .expect(201)
    ).body as BusinessCalendarView;
    expect(view.pending).toEqual([
      {
        id: expect.any(String),
        action: "ADD",
        date,
        name: "Typhoon suspension",
        reason: "Declared by the Palace",
        requestedByName: expect.any(String),
        requestedAt: expect.any(String),
        allowedActions: {
          approve: false,
          reject: true,
          approveBlockedReason:
            "You drafted this change; a different administrator must approve it.",
        },
      },
    ]);
    const id = view.pending[0]?.id as string;
    expect(await audits("HOLIDAY_CHANGE_REQUESTED")).toBe(requested + 1);
    // Nothing changes yet.
    expect((await holidays()).some((d) => d.date === date)).toBe(false);
    expect((await calendar("celia")).pending[0]?.allowedActions).toEqual({
      approve: true,
      reject: true,
      approveBlockedReason: null,
    });

    const self = await h.as("leo").post(`/calendar/changes/${id}/approve`, {}).expect(403);
    expect(self.body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await holidays()).some((d) => d.date === date)).toBe(false);

    const approved = (
      await h.as("celia").post(`/calendar/changes/${id}/approve`, { note: "Confirmed" }).expect(200)
    ).body as BusinessCalendarView;
    expect(approved.pending).toEqual([]);
    expect(approved.holidays).toContainEqual({ date, name: "Typhoon suspension" });
    expect(await holidays()).toContainEqual({ date, name: "Typhoon suspension" });
    expect(await audits("HOLIDAY_ADDED")).toBe(added + 1);
    const [entry] = await h.ds.query(
      "SELECT actor_id, details FROM audit_event WHERE action = 'HOLIDAY_ADDED' ORDER BY seq DESC LIMIT 1",
    );
    expect(entry.actor_id).toBe("STF-CELIA");
    expect(entry.details).toMatchObject({
      date,
      before: { holiday: null },
      after: { holiday: "Typhoon suspension" },
      requestedBy: "STF-LEO",
      note: "Confirmed",
    });

    // Decided once: a second decision is refused and writes nothing.
    const again = await h.as("celia").post(`/calendar/changes/${id}/approve`, {}).expect(409);
    expect(again.body.detail).toBe("This change was already approved.");
    expect(await audits("HOLIDAY_ADDED")).toBe(added + 1);
  });

  it("removing a holiday the same way; a rejection or a withdrawal leaves the calendar as it is", async () => {
    const date = futureWorkday();
    await h.ds.query("INSERT INTO business_holiday (date, name) VALUES ($1, 'Local fiesta')", [
      date,
    ]);
    const rejected = await audits("HOLIDAY_CHANGE_REJECTED");
    const withdrawn = await audits("HOLIDAY_CHANGE_WITHDRAWN");
    const removed = await audits("HOLIDAY_REMOVED");

    // The name kept is the holiday's own, whatever the request says.
    const first = await draft({ action: "REMOVE", date, name: "ignored", reason: "Cancelled" });
    expect((await calendar()).pending[0]).toMatchObject({ action: "REMOVE", name: "Local fiesta" });
    await h.as("celia").post(`/calendar/changes/${first}/reject`, { note: "Still on" }).expect(200);
    expect(await holidays()).toContainEqual({ date, name: "Local fiesta" });
    expect(await audits("HOLIDAY_CHANGE_REJECTED")).toBe(rejected + 1);

    const second = await draft({ action: "REMOVE", date, reason: "Cancelled" });
    await h.as("leo").post(`/calendar/changes/${second}/reject`, {}).expect(200);
    expect(await audits("HOLIDAY_CHANGE_WITHDRAWN")).toBe(withdrawn + 1);
    expect(await holidays()).toContainEqual({ date, name: "Local fiesta" });

    const third = await draft({ action: "REMOVE", date, reason: "Cancelled" });
    await h.as("celia").post(`/calendar/changes/${third}/approve`, {}).expect(200);
    expect((await holidays()).some((d) => d.date === date)).toBe(false);
    expect(await audits("HOLIDAY_REMOVED")).toBe(removed + 1);
  });
});

describe("HC-8 the seed never overwrites the calendar", () => {
  it("a removed holiday stays removed when the seed runs again (as on every boot)", async () => {
    // The test's own holiday, so it does not depend on the seeded dates (they end in 2027).
    const date = futureWorkday(3);
    await h.ds.query("INSERT INTO business_holiday (date, name) VALUES ($1, 'Local fiesta')", [
      date,
    ]);
    const id = await draft({ action: "REMOVE", date, reason: "Proclamation withdrawn" });
    await h.as("celia").post(`/calendar/changes/${id}/approve`, {}).expect(200);
    expect((await holidays()).some((d) => d.date === date)).toBe(false);
    // A seeded day gone too (removed as only the table's owner could, so any date works, past
    // or future): an upsert of the demo calendar would bring exactly this one back.
    const seededDay = SEED_HOLIDAYS[0]?.date as string;
    await h.ds.query("DELETE FROM business_holiday WHERE date = $1", [seededDay]);

    await seed(h.ds);

    expect((await holidays()).some((d) => d.date === date)).toBe(false);
    expect((await holidays()).some((d) => d.date === seededDay)).toBe(false);
    const [last] = await h.ds.query(
      "SELECT action, details FROM audit_event ORDER BY seq DESC LIMIT 1",
    );
    expect(last.action).toBe("HOLIDAY_REMOVED");
    expect(last.details).toMatchObject({ date, after: { holiday: null } });
  });

  it("a calendar emptied by approved changes is not seeded again", async () => {
    await h.ds.query("DELETE FROM business_holiday");
    await h.ds.query(
      `INSERT INTO business_holiday_change
         (action, holiday_date, name, reason, status, requested_by, decided_by, decided_at)
       VALUES ('REMOVE', $1, 'Last holiday', 'Removed', 'APPROVED', 'STF-LEO', 'STF-CELIA', now())`,
      [futureWorkday()],
    );
    await seed(h.ds);
    expect(await holidays()).toEqual([]);
  });

  // A guard for the empty-table condition (a fresh environment still gets the demo calendar),
  // not a regression test.
  it("guard: an empty calendar with no approved change is seeded", async () => {
    await h.ds.query("DELETE FROM business_holiday");
    await seed(h.ds);
    expect(await holidays()).toEqual(SEED_HOLIDAYS);
  });

  // A guard, too: today the two seeds also serialise on the staff rows they both upsert
  // first, so this passes even without ON CONFLICT DO NOTHING; that clause is what keeps it
  // safe if the seed's order or contents change.
  it("guard: two seeds at once on an empty calendar both succeed (replicas booting together)", async () => {
    await h.ds.query("DELETE FROM business_holiday");
    const results = await Promise.allSettled([seed(h.ds), seed(h.ds)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await holidays()).toEqual(SEED_HOLIDAYS);
  });
});

describe("HC-4 refusals write nothing", () => {
  it("past and current days, weekends, a day already a holiday or not one, a second draft, bad input", async () => {
    const date = futureWorkday();
    const requested = await audits("HOLIDAY_CHANGE_REQUESTED");
    const refuse = async (body: object, status: number) =>
      (await h.as("leo").post("/calendar/changes", body).expect(status)).body;

    const add = { action: "ADD", name: "Typhoon suspension", reason: "Declared" };
    for (const day of [manilaDay(), manilaDay(-1), manilaDay(-400)]) {
      expect((await refuse({ ...add, date: day }, 400)).errors).toEqual([
        {
          field: "date",
          message: "Only days after today can change; past and current days were already measured.",
        },
      ]);
    }
    expect((await refuse({ ...add, date: futureSaturday() }, 400)).errors).toEqual([
      {
        field: "date",
        message: "That day is a Saturday or a Sunday, already outside business time.",
      },
    ]);
    expect((await refuse({ ...add, date: "2027-02-30" }, 400)).errors).toEqual([
      { field: "date", message: "Enter a real date, YYYY-MM-DD." },
    ]);
    // Refused by the DTO: the field is named, and the message goes on in words.
    const malformed = await refuse({ ...add, date: "30/01/2027" }, 400);
    expect(malformed.code).toBe("VALIDATION_FAILED");
    expect(malformed.errors[0]).toEqual({
      field: "date",
      message: "date Enter a real date, YYYY-MM-DD.",
    });
    expect((await refuse({ ...add, date, name: "x".repeat(81) }, 400)).errors[0].field).toBe(
      "name",
    );
    expect((await refuse({ ...add, date, name: " " }, 400)).errors).toEqual([
      { field: "name", message: "Enter a name." },
    ]);
    expect((await refuse({ ...add, date, reason: " " }, 400)).errors).toEqual([
      { field: "reason", message: "Enter a reason." },
    ]);
    expect((await refuse({ ...add, date, action: "MOVE" }, 400)).errors[0].field).toBe("action");
    expect((await refuse({ action: "REMOVE", date, reason: "x" }, 409)).detail).toBe(
      `${worded(date)} is not a holiday in the calendar.`,
    );

    const later = futureWorkday(2);
    await h.ds.query("INSERT INTO business_holiday (date, name) VALUES ($1, 'Local fiesta')", [
      later,
    ]);
    expect((await refuse({ ...add, date: later }, 409)).detail).toBe(
      `${worded(later)} is already a holiday (Local fiesta).`,
    );

    expect(await changes()).toBe(0);
    expect(await audits("HOLIDAY_CHANGE_REQUESTED")).toBe(requested);

    await draft({ ...add, date });
    expect(
      (await refuse({ action: "ADD", date, name: "Other", reason: "Again" }, 409)).detail,
    ).toBe(
      `A change to ${worded(date)} is already waiting for approval. Approve or reject it first.`,
    );
    expect(await changes()).toBe(1);

    const missing = "00000000-0000-4000-8000-000000000000";
    await h.as("celia").post(`/calendar/changes/${missing}/approve`, {}).expect(404);
    await h.as("celia").post("/calendar/changes/not-a-uuid/approve", {}).expect(400);
  });

  it("approval checks the rules again: a day that has arrived, or a calendar changed since", async () => {
    const date = futureWorkday();
    const arrived = await draft({ action: "ADD", date, name: "Typhoon", reason: "Declared" });
    // The day arrives while the request waits (moved here as only the table's owner could).
    await h.ds.query("UPDATE business_holiday_change SET holiday_date = $2 WHERE id = $1", [
      arrived,
      manilaDay(),
    ]);
    const before = await holidays();
    const late = await h.as("celia").post(`/calendar/changes/${arrived}/approve`, {}).expect(409);
    expect(late.body.detail).toMatch(
      /^Only days after today can change.* Reject this request instead\.$/,
    );
    expect(await holidays()).toEqual(before);
    await h.as("celia").post(`/calendar/changes/${arrived}/reject`, {}).expect(200);

    const raced = await draft({ action: "ADD", date, name: "Typhoon", reason: "Declared" });
    await h.ds.query("INSERT INTO business_holiday (date, name) VALUES ($1, 'Local fiesta')", [
      date,
    ]);
    const stale = await h.as("celia").post(`/calendar/changes/${raced}/approve`, {}).expect(409);
    expect(stale.body.detail).toBe(
      `${worded(date)} is already a holiday (Local fiesta). Reject this request instead.`,
    );
    expect(await holidays()).toContainEqual({ date, name: "Local fiesta" });
  });
});

describe("HC-5 races", () => {
  it("approve and reject at once: exactly one wins", async () => {
    const id = await draft({
      action: "ADD",
      date: futureWorkday(),
      name: "Typhoon",
      reason: "Declared",
    });
    const [a, b] = await Promise.all([
      h.as("celia").post(`/calendar/changes/${id}/approve`, {}),
      h.as("leo").post(`/calendar/changes/${id}/reject`, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await pendingCount()).toBe(0);
  });

  it("two drafts for one date at once: one waits, the other is refused", async () => {
    const body = { action: "ADD", date: futureWorkday(), name: "Typhoon", reason: "Declared" };
    const [a, b] = await Promise.all([
      h.as("leo").post("/calendar/changes", body),
      h.as("celia").post("/calendar/changes", body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await pendingCount()).toBe(1);
  });

  it("the partial unique index, reached past the lock, gives the same 409 and writes nothing", async () => {
    const date = futureWorkday();
    const requested = await audits("HOLIDAY_CHANGE_REQUESTED");
    // A pending row for the date, uncommitted and written without the date's lock: the
    // request's own check cannot see it, so its insert waits on the index, then fails.
    const qr = h.ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      await qr.query(
        `INSERT INTO business_holiday_change (action, holiday_date, name, reason, status, requested_by)
         VALUES ('ADD', $1, 'Typhoon', 'Other session', 'PENDING', 'STF-CELIA')`,
        [date],
      );
      const res = h
        .as("leo")
        .post("/calendar/changes", { action: "ADD", date, name: "Typhoon", reason: "Declared" })
        .then((r) => r);
      let blocked = false;
      for (let i = 0; i < 200 && !blocked; i++) {
        blocked =
          (await count(
            h.ds,
            "SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'",
          )) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);
      await qr.commitTransaction();
      const refused = await res;
      expect(refused.status).toBe(409);
      expect(refused.body.detail).toBe(
        `A change to ${worded(date)} is already waiting for approval. Approve or reject it first.`,
      );
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
    expect(await pendingCount()).toBe(1);
    expect(await audits("HOLIDAY_CHANGE_REQUESTED")).toBe(requested);
  });
});

/** Move a case's stage entry by `days` (forward when positive), as the table's owner could. */
async function shiftEntry(caseId: string, days: number): Promise<void> {
  // One transaction: the guard is off only inside it, and back on even if the update fails
  // (a rollback undoes the DISABLE too), and no other session ever sees it off.
  await h.ds.transaction(async (m) => {
    await m.query("ALTER TABLE activity_event DISABLE TRIGGER activity_event_insert_only");
    await m.query(
      `UPDATE activity_event SET created_at = created_at + ($2 || ' days')::interval
        WHERE case_id = $1`,
      [caseId, String(days)],
    );
    await m.query("ALTER TABLE activity_event ENABLE TRIGGER activity_event_insert_only");
  });
}

describe("HC-6 the business clock follows the calendar", () => {
  it("an approved holiday moves an open case's SLA due time past it; removing it moves it back", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(c.status).toBe("REVIEW");
    // Its stage starts tomorrow, so its 8-business-hour clock falls due on a day after today
    // (only those can change), whatever time the suite runs.
    await shiftEntry(c.id, 1);
    const clock = async () =>
      ((await h.as("paolo").get(`/sla/cases/${c.id}`).expect(200)).body as { sla: SlaView }).sla;
    const before = await clock();
    const due = manilaDateOf(before.dueAt);
    expect(due > manilaDay()).toBe(true);

    const id = await draft({ action: "ADD", date: due, name: "Typhoon", reason: "Declared" });
    // Drafted only: the clock is unchanged.
    expect((await clock()).dueAt).toBe(before.dueAt);
    await h.as("celia").post(`/calendar/changes/${id}/approve`, {}).expect(200);
    const after = await clock();
    expect(after.enteredAt).toBe(before.enteredAt);
    expect(Date.parse(after.dueAt)).toBeGreaterThan(Date.parse(before.dueAt));
    expect(manilaDateOf(after.dueAt) > due).toBe(true);

    const back = await draft({ action: "REMOVE", date: due, reason: "Lifted" });
    await h.as("celia").post(`/calendar/changes/${back}/approve`, {}).expect(200);
    expect((await clock()).dueAt).toBe(before.dueAt);
  });
});
