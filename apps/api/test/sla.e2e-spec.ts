import type { SlaView, TurnaroundReport } from "@loan/core";
import { type Harness, startHarness, submitCase } from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

/** When the case last entered its current status, from the activity history. */
const enteredAt = async (caseId: string): Promise<string> =>
  (
    (await h.ds.query(
      `SELECT max(e.created_at) AS at FROM activity_event e JOIN loan_case c ON c.id = e.case_id
        WHERE e.case_id = $1 AND e.to_status = c.status`,
      [caseId],
    )) as { at: Date }[]
  )[0]?.at.toISOString() as string;

/** Move a case's stage entry back in time, as the table's owner would have to. */
async function backdateEntry(caseId: string, days: number): Promise<void> {
  await h.ds.query("ALTER TABLE activity_event DISABLE TRIGGER activity_event_insert_only");
  try {
    await h.ds.query(
      `UPDATE activity_event SET created_at = created_at - ($2 || ' days')::interval
        WHERE case_id = $1`,
      [caseId, String(days)],
    );
  } finally {
    await h.ds.query("ALTER TABLE activity_event ENABLE TRIGGER activity_event_insert_only");
  }
}

const businessDate = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe("stage SLAs in Philippine business time (PRD WF-003, PLT-005)", () => {
  it("SLA-1 a referred case's review clock starts when the decision moved it to Review", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(c.status).toBe("REVIEW");
    const queue = (await h.as("paolo").get("/sla/cases").expect(200)).body as SlaView[];
    const clock = queue.find((s) => s.caseId === c.id);
    expect(clock).toMatchObject({
      status: "REVIEW",
      targetMinutes: 480,
      enteredAt: await enteredAt(c.id),
      owner: "Loan officer",
    });
    expect(clock?.elapsedMinutes).toBeLessThan(5);
    expect(clock?.state).toBe("ON_TRACK");

    const one = (await h.as("diane").get(`/sla/cases/${c.id}`).expect(200)).body as {
      sla: SlaView;
      holidayCalendarEnds: string;
    };
    expect(one.sla.dueAt).toBe(clock?.dueAt);
    // The seeded calendar's reach (the last date in SEED_HOLIDAYS, packages/base/src/seed/seed.ts),
    // so the views can say when it runs out.
    expect(one.holidayCalendarEnds).toBe("2027-06-12");
  });

  it("SLA-2 past its target the case is breached; editing the case row does not move the clock", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await backdateEntry(c.id, 10);
    // updated_at is a clock any edit moves: the SLA must not read it.
    await h.ds.query("UPDATE loan_case SET updated_at = now() WHERE id = $1", [c.id]);
    const { sla } = (await h.as("paolo").get(`/sla/cases/${c.id}`).expect(200)).body as {
      sla: SlaView;
    };
    expect(sla.state).toBe("BREACHED");
    expect(sla.remainingMinutes).toBeLessThan(0);
    expect(sla.elapsedMinutes).toBeGreaterThanOrEqual(480);
    expect(sla.enteredAt).toBe(await enteredAt(c.id));

    // The recommendation moves it to Approval: a fresh 4-hour clock.
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "APPROVE",
        rationale: "Reviewed: approve as requested.",
      })
      .expect(200);
    const next = (await h.as("rina").get(`/sla/cases/${c.id}`).expect(200)).body as {
      sla: SlaView;
    };
    expect(next.sla).toMatchObject({ status: "APPROVAL", targetMinutes: 240, state: "ON_TRACK" });
  });

  it("SLA-3 stages without a clock answer null; visibility follows the case's own", async () => {
    const draft = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "50000.00",
      submit: false,
    });
    expect(
      ((await h.as("paolo").get(`/sla/cases/${draft.id}`).expect(200)).body as { sla: unknown })
        .sla,
    ).toBeNull();
    const review = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    // Loan operations cannot see a case in review: 404, as for the case itself.
    await h.as("marco").get(`/sla/cases/${review.id}`).expect(404);
    const opsQueue = (await h.as("marco").get("/sla/cases?view=all").expect(200)).body as SlaView[];
    expect(opsQueue.some((s) => s.caseId === review.id)).toBe(false);
    await h.as("leo").get("/sla/cases").expect(403);
    await h.as("leo").get(`/sla/cases/${review.id}`).expect(403);
    await h.anonymous().get("/sla/cases").expect(401);
    await h.anonymous().get(`/sla/cases/${review.id}`).expect(401);
    await h.as("paolo").get("/sla/cases/not-a-uuid").expect(400);
    await h.as("paolo").get("/sla/cases?view=mine").expect(400);
  });
});

describe("turnaround report (PRD RPT-002)", () => {
  it("TAT-1 time per stage in business minutes, open cases by SLA state, holidays skipped", async () => {
    const breached = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await backdateEntry(breached.id, 10);
    const done = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await h
      .as("paolo")
      .post(`/cases/${done.id}/recommendation`, {
        type: "APPROVE",
        rationale: "Reviewed: approve as requested.",
      })
      .expect(200);

    const r = (await h.as("rina").get("/reports/turnaround").expect(200)).body as TurnaroundReport;
    const review = r.stages.find((s) => s.status === "REVIEW");
    expect(review?.visits).toBeGreaterThanOrEqual(1);
    expect(review?.targetMinutes).toBe(480);
    expect(review?.withinTarget).toBeGreaterThanOrEqual(1);
    expect(r.openNow.breached).toBeGreaterThanOrEqual(1);
    expect(r.openNow.onTrack).toBeGreaterThanOrEqual(1);
    expect(r.businessDay).toEqual({ start: "09:00", end: "17:00" });

    const bonifacio = (
      await h.as("diane").get("/reports/turnaround?from=2026-11-01&to=2026-12-31").expect(200)
    ).body as TurnaroundReport;
    expect(bonifacio.holidays).toEqual(
      expect.arrayContaining([{ date: "2026-11-30", name: "Bonifacio Day" }]),
    );
    expect(bonifacio.period).toEqual({ from: "2026-11-01", to: "2026-12-31" });
    // The last date in SEED_HOLIDAYS (packages/base/src/seed/seed.ts).
    expect(bonifacio.holidayCalendarEnds).toBe("2027-06-12");
  });

  it("TAT-2 officers, approvers, Compliance and the administrator read it; loan operations 403; bad periods 400", async () => {
    for (const persona of ["paolo", "rina", "diane", "leo"] as const) {
      const r = (await h.as(persona).get("/reports/turnaround").expect(200))
        .body as TurnaroundReport;
      expect(r.stages.map((s) => s.status)).toEqual([
        "REVIEW",
        "APPROVAL",
        "BOOKING",
        "PENDING_CHECKER",
        "BOOKING_FAILED",
      ]);
    }
    for (const persona of ["marco", "ella"] as const) {
      await h.as(persona).get("/reports/turnaround").expect(403);
    }
    await h.anonymous().get("/reports/turnaround").expect(401);
    await h
      .as("rina")
      .get(`/reports/turnaround?from=${businessDate()}&to=${businessDate(-1)}`)
      .expect(400);
    await h.as("rina").get("/reports/turnaround?from=2026-02-31").expect(400);
  });
});
