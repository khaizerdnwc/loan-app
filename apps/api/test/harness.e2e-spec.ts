import { DomainError, GovernanceRepository, GovernanceService, type SessionUser } from "@loan/base";
import type { CaseDetail, HarnessRunView } from "@loan/core";
import {
  count,
  type Harness,
  resetData,
  setMode,
  startHarness,
  submitCase,
  twin,
} from "./support/harness";

const LEO: SessionUser = { id: "STF-LEO", fullName: "Leo Santiago", role: "ADMIN" };

/**
 * The rule-set test harness through the API (PRD DEC-004, F8 step 1; ACCEPTANCE HX-2): stored
 * decisions replayed under a candidate and a baseline rule set and compared, by administrators
 * and compliance only. It writes one audit entry (counts, no case data) and nothing else. The
 * audit log is insert-only, so the tests count harness entries before and after.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await resetData(h.ds);
});

const harnessEntries = () =>
  count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE action = 'HARNESS_RUN'");

/** Maria's twin with 80% utilisation and new to bank: 702, near the approve edge. */
async function nearApprove(): Promise<CaseDetail> {
  const id = await twin(h, "APL-MARIA");
  await h.ds.query(
    `UPDATE sim.persona_profile SET bureau = bureau || '{"utilisationPct": 80}'::jsonb WHERE applicant_id = $1`,
    [id],
  );
  await h.ds.query("UPDATE applicant SET relationship_months = 0 WHERE id = $1", [id]);
  return submitCase(h, { applicantId: id }, { sameApplicant: true });
}

const writes = async () => ({
  decisions: await count(h.ds, "SELECT count(*) AS n FROM decision_record"),
  cases: await count(h.ds, "SELECT count(*) AS n FROM loan_case"),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event"),
  calls: await count(h.ds, "SELECT count(*) AS n FROM provider_call"),
});

describe("HX-2 the rule-set test harness through the API", () => {
  it("compares RS-PL-5 with RS-PL-4 over the period's decisions, writing only one audit entry", async () => {
    const maria = await submitCase(h, { applicantId: "APL-MARIA" });
    const nina = await submitCase(h, {
      applicantId: "APL-NINA",
      amount: "80000.00",
      tenorMonths: 18,
    });
    const near = await nearApprove();
    const before = await writes();
    const entriesBefore = await harnessEntries();

    const res = await h
      .as("leo")
      .post("/models/harness", { candidate: "RS-PL-5", baseline: "RS-PL-4" })
      .expect(200);
    const run = res.body as HarnessRunView;
    expect(run).toMatchObject({
      candidate: "RS-PL-5",
      baseline: "RS-PL-4",
      cap: 300,
      decisionsInPeriod: 3,
      compared: 3,
      notComparable: [],
    });
    const byRef = new Map(run.changed.map((r) => [r.caseReference, r]));
    expect(byRef.get(near.reference)).toMatchObject({
      baselineOutcome: "AUTO_APPROVE",
      candidateOutcome: "REFER",
      reasonsAdded: [{ code: "R27", staff: expect.stringMatching(/^Low model confidence/) }],
    });
    expect(byRef.get(nina.reference)?.reasonsAdded.map((r) => r.code)).toEqual(["R27"]);
    expect(byRef.has(maria.reference)).toBe(false);
    expect(run.movement.reduce((n, m) => n + m.count, 0)).toBe(3);
    // Case references and counts only: no names, amounts or inputs.
    expect(JSON.stringify(run)).not.toMatch(/Maria|Santos|monthlyIncome|150000/);

    // Nothing about a case, decision or provider changed; one audit entry, with counts only.
    expect(await writes()).toEqual(before);
    expect(await harnessEntries()).toBe(entriesBefore + 1);
    const [entry] = (await h.ds.query(
      `SELECT actor_id, details, case_id, case_reference FROM audit_event
       WHERE action = 'HARNESS_RUN' ORDER BY seq DESC LIMIT 1`,
    )) as {
      actor_id: string;
      details: unknown;
      case_id: string | null;
      case_reference: string | null;
    }[];
    expect(entry).toMatchObject({
      actor_id: "STF-LEO",
      case_id: null,
      case_reference: null,
      details: {
        candidate: "RS-PL-5",
        baseline: "RS-PL-4",
        period: run.period,
        decisionsInPeriod: 3,
        compared: 3,
        changed: 2,
        notComparable: 0,
        withDefaults: 0,
        cap: 300,
      },
    });
    expect(JSON.stringify(entry)).not.toContain(near.reference);
  });

  it("defaults the baseline to the live rule set; compliance may run it", async () => {
    await submitCase(h, { applicantId: "APL-MARIA" });
    const run = (await h.as("diane").post("/models/harness", { candidate: "RS-PL-4" }).expect(200))
      .body as HarnessRunView;
    expect(run.baseline).toBe("RS-PL-5");
    expect(run.compared).toBe(1);
  });

  it("other roles get 403 and no session 401, recording nothing", async () => {
    const entriesBefore = await harnessEntries();
    for (const persona of ["paolo", "rina", "marco"] as const) {
      await h.as(persona).post("/models/harness", { candidate: "RS-PL-4" }).expect(403);
    }
    await h.anonymous().post("/models/harness").send({ candidate: "RS-PL-4" }).expect(401);
    expect(await harnessEntries()).toBe(entriesBefore);
  });

  it("refuses an unknown or repeated rule set, a bad period and extra fields (400), recording nothing", async () => {
    const entriesBefore = await harnessEntries();
    const post = (body: object) => h.as("leo").post("/models/harness", body);
    expect((await post({ candidate: "RS-PL-9" }).expect(400)).body.detail).toMatch(
      /rule sets this system knows/,
    );
    await post({ candidate: "RS-PL-4", baseline: "RS-XX" }).expect(400);
    expect((await post({ candidate: "RS-PL-5" }).expect(400)).body.detail).toMatch(/different/);
    await post({ candidate: "RS-PL-4", from: "2026-02-31" }).expect(400);
    await post({ candidate: "RS-PL-4", from: "2026-11-20", to: "2026-11-01" }).expect(400);
    await post({ candidate: "RS-PL-4", from: "2025-01-01", to: "2026-11-20" }).expect(400);
    await post({ candidate: "RS-PL-4", publish: true }).expect(400);
    await post({}).expect(400);
    expect(await harnessEntries()).toBe(entriesBefore);
  });

  it("a name off Object.prototype is no rule set: 'constructor' is 400 and records nothing, at the API and in the service", async () => {
    const entriesBefore = await harnessEntries();
    for (const name of ["constructor", "__proto__", "toString"]) {
      await h.as("leo").post("/models/harness", { candidate: name }).expect(400);
      await h
        .as("leo")
        .post("/models/harness", { candidate: "RS-PL-4", baseline: name })
        .expect(400);
    }
    // Past the request's shape check too: the service reads own keys only.
    const service = h.app.get(GovernanceService);
    const refused = await service
      .harness(LEO, { candidate: "constructor" })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).status).toBe(400);
    expect(await harnessEntries()).toBe(entriesBefore);
  });
});

describe("HX-2 which decisions a run replays", () => {
  it("a re-decided case contributes only its latest decision", async () => {
    await setMode(h, "FRAUD", "OUTAGE");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    await setMode(h, "FRAUD", "OK");
    await h.as("paolo").post(`/cases/${c.id}/redecide`).expect(200);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM decision_record WHERE case_id = $1", [c.id]),
    ).toBe(2);

    const repo = h.app.get(GovernanceRepository);
    const day = 86_400_000;
    const { total, rows } = await repo.harnessSnapshots(
      new Date(Date.now() - day),
      new Date(Date.now() + day),
      300,
    );
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    // The latest decision (fraud check answered), not the first (fraud check unavailable).
    expect(rows[0]?.inputs.fraud).toMatchObject({ status: "OK" });

    const run = (await h.as("leo").post("/models/harness", { candidate: "RS-PL-4" }).expect(200))
      .body as HarnessRunView;
    expect([run.decisionsInPeriod, run.compared]).toEqual([1, 1]);
  });

  it("the period is half-open at its end: a decision at the window's end is out, one just inside is in", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    // A decision with a whole-millisecond time (created_at keeps microseconds, which a JS Date
    // would truncate, so a submitted decision cannot tell < from <=). A copy of the case's
    // decision, inserted with an explicit time months ago (insert-only allows INSERT).
    const at = "2026-06-15T12:00:00.000Z";
    await h.ds.query(
      `INSERT INTO decision_record
       SELECT (jsonb_populate_record(NULL::decision_record, to_jsonb(d)
         || jsonb_build_object('id', uuid_generate_v4(), 'created_at', $2::timestamptz))).*
       FROM decision_record d WHERE d.case_id = $1`,
      [c.id, at],
    );
    const repo = h.app.get(GovernanceRepository);
    const t = Date.parse(at);
    // Both queries (the count and the rows) must agree on the bounds.
    const window = async (from: number, until: number) => {
      const { total, rows } = await repo.harnessSnapshots(new Date(from), new Date(until), 300);
      expect(rows).toHaveLength(total);
      return total;
    };
    expect(await window(t - 1000, t)).toBe(0); // ends at the decision: excluded
    expect(await window(t - 1000, t + 1)).toBe(1); // ends just after: included
    expect(await window(t, t + 1000)).toBe(1); // starts at the decision: included
    expect(await window(t + 1, t + 1000)).toBe(0); // starts after: excluded
    // Through the API: a period that ended before today leaves today's decision out.
    const run = (
      await h
        .as("leo")
        .post("/models/harness", { candidate: "RS-PL-4", from: "2026-01-01", to: "2026-01-31" })
        .expect(200)
    ).body as HarnessRunView;
    expect([run.decisionsInPeriod, run.compared]).toEqual([0, 0]);
  });

  it("the cap cuts the list to the newest cases: more cases in the period than compared", async () => {
    const a = await submitCase(h, { applicantId: "APL-MARIA" });
    const b = await submitCase(h, { applicantId: "APL-MARIA" });
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const service = h.app.get(GovernanceService);
    // A lower cap than the API's, to see the cut-off with three cases.
    const run = await service.harness(LEO, { candidate: "RS-PL-4" }, 2);
    expect(run).toMatchObject({ cap: 2, decisionsInPeriod: 3, compared: 2 });
    // The two newest were replayed; the oldest was cut. Ask for the rows to see which.
    const repo = h.app.get(GovernanceRepository);
    const day = 86_400_000;
    const { rows } = await repo.harnessSnapshots(
      new Date(Date.now() - day),
      new Date(Date.now() + day),
      2,
    );
    expect(rows.map((r) => r.caseReference)).toEqual([c.reference, b.reference]);
    expect(rows.map((r) => r.caseReference)).not.toContain(a.reference);
  });
});
