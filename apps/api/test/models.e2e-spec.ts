import type { AutomationView, DriftView, ModelRegistryView, OverrideMonitorView } from "@loan/core";
import { type Harness, setMode, startHarness, submitCase } from "./support/harness";

/**
 * Model governance through the API (PRD AIS-008, AIS-009, AIS-011, AIS-012; ACCEPTANCE
 * MG-2..MG-4): the registry with its prohibited-features check, override monitoring with
 * not-live agreement, and drift. Read by administrators and compliance only.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE automation_change, automation_event");
  await h.ds.query(`INSERT INTO product_automation (product_code, mode) VALUES ('PL', 'LIVE')
    ON CONFLICT (product_code) DO UPDATE SET mode = 'LIVE', kill_switch = false,
      kill_switch_set_by = NULL, kill_switch_set_at = NULL`);
});

const overrides = async () =>
  (await h.as("diane").get("/models/overrides").expect(200)).body as OverrideMonitorView;

describe("MG-2 the model registry lists every version, its use and the prohibited-features check", () => {
  it("names the current scorecard and rule set, their features and decision counts", async () => {
    await submitCase(h, { applicantId: "APL-MARIA" });
    const r = (await h.as("leo").get("/models").expect(200)).body as ModelRegistryView;
    const sc2 = r.scorecards.find((s) => s.version === "SC-PL-2");
    expect(sc2).toMatchObject({ current: true, hasPd: true, prohibitedFeatures: [] });
    expect(sc2?.decisions).toBeGreaterThanOrEqual(1);
    expect(sc2?.features).toContain("bureau.bureauScore");
    expect(r.scorecards.find((s) => s.version === "SC-PL-1")).toMatchObject({
      current: false,
      hasPd: false,
    });
    expect(r.ruleSets.map((x) => [x.version, x.current])).toEqual([
      ["RS-PL-1", false],
      ["RS-PL-2", false],
      ["RS-PL-3", true],
    ]);
    expect(r.prohibitedFeatures).toEqual(
      expect.arrayContaining(["applicant.gender", "applicant.ageYears"]),
    );
  });

  it("is read by administrators and compliance only", async () => {
    for (const persona of ["paolo", "rina", "marco"] as const) {
      await h.as(persona).get("/models").expect(403);
      await h.as(persona).get("/models/overrides").expect(403);
      await h.as(persona).get("/models/drift").expect(403);
    }
    await h.as("diane").get("/models").expect(200);
    const bad = await h.as("leo").get("/models/drift?recentDays=0").expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });
});

describe("MG-3 override monitoring: overrides by reason, and agreement where the engine only advised", () => {
  it("counts a counter-offer override and a shadow-mode decision the person agreed with", async () => {
    const before = await overrides();

    const joel = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await h
      .as("paolo")
      .post(`/cases/${joel.id}/recommendation`, {
        type: "COUNTER_OFFER",
        amount: "120000.00",
        tenorMonths: 36,
        overrideReason: "OV04",
        rationale: "Lower exposure",
      })
      .expect(200);

    // Shadow mode, two administrators; Maria's engine outcome would be an approval.
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SHADOW", reason: "Pilot" })
      .expect(201);
    const list = (await h.as("celia").get("/automation").expect(200)).body as AutomationView[];
    const pending = list.find((v) => v.productCode === "PL")?.pendingChange?.id;
    await h.as("celia").post(`/automation/PL/changes/${pending}/approve`, {}).expect(200);
    const maria = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(maria.status).toBe("REVIEW");
    await h
      .as("paolo")
      .post(`/cases/${maria.id}/recommendation`, { type: "APPROVE", rationale: "Agree" })
      .expect(200);

    const after = await overrides();
    expect(after.recommendations - before.recommendations).toBe(2);
    expect(after.overrides - before.overrides).toBe(1);
    const ov04 = (v: OverrideMonitorView) => v.byReason.find((x) => x.code === "OV04")?.count ?? 0;
    expect(ov04(after) - ov04(before)).toBe(1);
    expect(after.notLive.compared - before.notLive.compared).toBe(1);
    expect(after.notLive.agreed - before.notLive.agreed).toBe(1);
    expect(after.matrix).toContainEqual(
      expect.objectContaining({ engineOutcome: "REFER", recommendation: "COUNTER_OFFER" }),
    );
  });
});

describe("MG-3 a recommendation keeps the engine outcome it acted on, after the case is decided again", () => {
  it("recommend on an outage referral, return, re-decide to an approval: the first recommendation still counts against the referral", async () => {
    await setMode(h, "FRAUD", "OUTAGE");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "DECLINE",
        overrideReason: "OV06",
        rationale: "Cannot verify without the fraud check",
      })
      .expect(200);
    await h.as("rina").post(`/cases/${c.id}/return`).expect(200);
    await setMode(h, "FRAUD", "OK");
    const redecided = await h.as("paolo").post(`/cases/${c.id}/redecide`).expect(200);
    expect(redecided.body.status).toBe("OFFER");

    const rows = (await h.ds.query(
      `SELECT d.outcome FROM activity_event e JOIN decision_record d ON d.id = (e.details->>'decisionId')::uuid
       WHERE e.case_id = $1 AND e.action = 'RECOMMENDED_WITH_OVERRIDE'`,
      [c.id],
    )) as { outcome: string }[];
    expect(rows).toEqual([{ outcome: "REFER" }]);
    const m = await overrides();
    expect(m.matrix).toContainEqual(
      expect.objectContaining({ engineOutcome: "REFER", recommendation: "DECLINE" }),
    );
    expect(
      m.matrix.some((x) => x.engineOutcome === "AUTO_APPROVE" && x.recommendation === "DECLINE"),
    ).toBe(false);
    await h.ds.query("TRUNCATE sim.service_mode");
  });
});

describe("MG-4 drift: grade shares in a recent window against a baseline", () => {
  it("reports both windows; with too few scored decisions it gives no status", async () => {
    await submitCase(h, { applicantId: "APL-MARIA" });
    const d = (await h.as("diane").get("/models/drift?recentDays=30&baselineDays=90").expect(200))
      .body as DriftView;
    expect(d.recent.decisions).toBeGreaterThan(0);
    expect(d.grades.map((g) => g.grade)).toEqual(["A", "B", "C", "D", "E"]);
    expect(d.status).toBe("INSUFFICIENT_DATA");
    expect(d.minimumDecisions).toBe(30);
    // No figure on too little data.
    expect(d.psi).toBeNull();
  });
});
