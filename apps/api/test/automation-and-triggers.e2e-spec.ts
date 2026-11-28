import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AutomationService } from "@loan/base";
import type {
  AutomationEventView,
  AutomationView,
  CaseDetail,
  DecisionRecordView,
  ReproduceResult,
} from "@loan/core";
import { Logger } from "@nestjs/common";
import {
  count,
  FULL_CONSENT,
  type Harness,
  type Persona,
  setMode,
  startHarness,
  submitCase,
  truncateGuarded,
  twin,
} from "./support/harness";

/**
 * PRD §7.5 automation mode and kill switch (AU-1..AU-3) and the RS-PL-2 referral triggers
 * (TR-1..TR-2), through the real API. Every test starts from PL live with the switch off.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE sim.service_mode");
  await truncateGuarded(h.ds, ["automation_change", "automation_event"]);
  await h.ds.query(`INSERT INTO product_automation (product_code, mode) VALUES ('PL', 'LIVE')
    ON CONFLICT (product_code) DO UPDATE SET mode = 'LIVE', kill_switch = false,
      kill_switch_set_by = NULL, kill_switch_set_at = NULL`);
});

const pl = async (persona: Persona = "leo"): Promise<AutomationView> => {
  const list = (await h.as(persona).get("/automation").expect(200)).body as AutomationView[];
  const view = list.find((v) => v.productCode === "PL");
  if (!view) throw new Error("no PL automation");
  return view;
};
const changes = () => count(h.ds, "SELECT count(*) AS n FROM automation_change");
const events = async () =>
  (await h.as("diane").get("/automation/PL/history").expect(200)).body as AutomationEventView[];

/** Draft a mode change as one administrator and approve it as the other. */
async function switchTo(mode: "OFF" | "SHADOW" | "LIVE"): Promise<void> {
  await h
    .as("leo")
    .post("/automation/PL/changes", { kind: "SET_MODE", mode, reason: "test" })
    .expect(201);
  const pending = (await pl()).pendingChange;
  if (!pending) throw new Error("no pending change");
  await h.as("celia").post(`/automation/PL/changes/${pending.id}/approve`, {}).expect(200);
}

const decisionOf = async (c: CaseDetail) =>
  (await h.as("paolo").get(`/cases/${c.id}/decision`).expect(200)).body as DecisionRecordView;

describe("AU-1 changing a product's automation mode is maker-checker between two administrators", () => {
  it("one administrator drafts, the mode does not change until a different one approves", async () => {
    const drafted = await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SHADOW", reason: "Pilot" })
      .expect(201);
    const view = (drafted.body as AutomationView[]).find((v) => v.productCode === "PL");
    expect(view).toMatchObject({
      mode: "LIVE",
      pendingChange: {
        kind: "SET_MODE",
        requestedMode: "SHADOW",
        fromMode: "LIVE",
        status: "PENDING",
        requestedByName: "Leo Santiago",
      },
    });
    expect(view?.allowedActions).toContainEqual({
      action: "APPROVE_CHANGE",
      enabled: false,
      blockedBy: "MAKER_CHECKER_VIOLATION",
      detail: expect.stringMatching(/different administrator/),
    });
    expect(view?.allowedActions).toContainEqual({ action: "WITHDRAW_CHANGE", enabled: true });
    expect(view?.allowedActions.map((a) => a.action)).not.toContain("REJECT_CHANGE");
    const celiaView = await pl("celia");
    expect(celiaView.allowedActions).toContainEqual({ action: "APPROVE_CHANGE", enabled: true });
    expect(celiaView.allowedActions).toContainEqual({ action: "REJECT_CHANGE", enabled: true });

    // Only an administrator may approve or reject; the change stays pending.
    for (const persona of ["diane", "paolo"] as const) {
      const pendingId = view?.pendingChange?.id;
      await h.as(persona).post(`/automation/PL/changes/${pendingId}/approve`, {}).expect(403);
      await h.as(persona).post(`/automation/PL/changes/${pendingId}/reject`, {}).expect(403);
    }
    expect((await pl()).pendingChange).toMatchObject({ status: "PENDING" });
    expect((await pl()).mode).toBe("LIVE");

    const id = view?.pendingChange?.id;
    const own = await h.as("leo").post(`/automation/PL/changes/${id}/approve`, {}).expect(403);
    expect(own.body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await pl()).mode).toBe("LIVE");

    await h.as("celia").post(`/automation/PL/changes/${id}/approve`, { note: "ok" }).expect(200);
    expect(await pl()).toMatchObject({ mode: "SHADOW", killSwitch: false, pendingChange: null });

    const history = await events();
    expect(history.map((e) => [e.action, e.actorName])).toEqual([
      ["MODE_CHANGED", "Celia Ortiz"],
      ["MODE_CHANGE_REQUESTED", "Leo Santiago"],
    ]);
    expect(history[0]?.details).toMatchObject({
      before: { mode: "LIVE", killSwitch: false },
      after: { mode: "SHADOW", killSwitch: false },
      requestedBy: "STF-LEO",
      reason: "Pilot",
      note: "ok",
    });
    // Approving it again is refused: it is no longer pending.
    const again = await h.as("celia").post(`/automation/PL/changes/${id}/approve`, {}).expect(409);
    expect(again.body.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("only one change waits per product; a second draft is refused and stores nothing", async () => {
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "OFF", reason: "a" })
      .expect(201);
    const second = await h
      .as("celia")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SHADOW", reason: "b" })
      .expect(409);
    expect(second.body.detail).toMatch(/drafted by Leo Santiago is waiting for approval/);
    expect(await changes()).toBe(1);
  });

  it("two drafts at once make exactly one pending change (the product row lock)", async () => {
    const results = await Promise.all([
      h.as("leo").post("/automation/PL/changes", { kind: "SET_MODE", mode: "OFF", reason: "a" }),
      h
        .as("celia")
        .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SHADOW", reason: "b" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await changes()).toBe(1);
  });

  it("a different administrator rejects; the drafter withdraws; the product does not change", async () => {
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "OFF", reason: "a" })
      .expect(201);
    const first = (await pl()).pendingChange?.id;
    await h.as("celia").post(`/automation/PL/changes/${first}/reject`, {}).expect(200);
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SHADOW", reason: "b" })
      .expect(201);
    const second = (await pl()).pendingChange?.id;
    await h.as("leo").post(`/automation/PL/changes/${second}/reject`, {}).expect(200);
    expect(await pl()).toMatchObject({ mode: "LIVE", pendingChange: null });
    const statuses = (await h.ds.query(
      "SELECT status FROM automation_change ORDER BY requested_at",
    )) as { status: string }[];
    expect(statuses.map((s) => s.status)).toEqual(["REJECTED", "WITHDRAWN"]);
    expect((await events()).map((e) => e.action)).toEqual([
      "CHANGE_WITHDRAWN",
      "MODE_CHANGE_REQUESTED",
      "CHANGE_REJECTED",
      "MODE_CHANGE_REQUESTED",
    ]);
  });

  it("refuses the current mode, a blank reason, an unknown mode or product, and other roles", async () => {
    const same = await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "LIVE", reason: "x" })
      .expect(400);
    expect(same.body.code).toBe("VALIDATION_FAILED");
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "OFF", reason: "  " })
      .expect(400);
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SOMETIMES", reason: "x" })
      .expect(400);
    await h
      .as("leo")
      .post("/automation/XX/changes", { kind: "SET_MODE", mode: "OFF", reason: "x" })
      .expect(404);
    for (const persona of ["paolo", "rina", "diane"] as const) {
      await h
        .as(persona)
        .post("/automation/PL/changes", { kind: "SET_MODE", mode: "OFF", reason: "x" })
        .expect(403);
      await h.as(persona).post("/automation/PL/kill-switch", { reason: "x" }).expect(403);
    }
    await h.as("paolo").get("/automation").expect(403);
    await h.as("paolo").get("/automation/PL/history").expect(403);
    // Compliance reads, with no actions offered.
    expect((await pl("diane")).allowedActions).toEqual([]);
    expect(await changes()).toBe(0);
    expect(await events()).toEqual([]);
  });
});

describe("AU-2 the mode decides what the engine's outcome does; the record stores the mode", () => {
  it("shadow: the engine's approval is recorded, the case goes to a person, who decides", async () => {
    await switchTo("SHADOW");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(d).toMatchObject({
      outcome: "REFER",
      engineOutcome: "AUTO_APPROVE",
      automationMode: "SHADOW",
      killSwitch: false,
      score: 742,
      grade: "A",
    });
    expect(d.reasonCodes.map((r) => r.code)).toEqual(["R20"]);
    expect((d.inputs as { automation: unknown }).automation).toEqual({
      mode: "SHADOW",
      killSwitch: false,
    });
    const replay = (await h.as("diane").post(`/decisions/${d.id}/reproduce`).expect(200))
      .body as ReproduceResult;
    expect(replay).toMatchObject({ match: true, inputsHashMatches: true });

    // A person decides: the officer recommends approval and an approver approves.
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, { type: "APPROVE", rationale: "Shadow pilot" })
      .expect(200);
    const approved = (await h.as("rina").post(`/cases/${c.id}/approve`).expect(200))
      .body as CaseDetail;
    expect(approved.status).toBe("OFFER");
  });

  it("off: every application is referred, and the record says so", async () => {
    await switchTo("OFF");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(d).toMatchObject({
      outcome: "REFER",
      automationMode: "OFF",
      engineOutcome: "AUTO_APPROVE",
    });
    expect(d.reasonCodes.map((r) => r.code)).toEqual(["R19"]);
  });

  it("not live, a knockout reaches a person, who may only decline it", async () => {
    await switchTo("OFF");
    const c = await submitCase(h, {
      applicantId: "APL-RAMON",
      amount: "50000.00",
      tenorMonths: 12,
    });
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(d).toMatchObject({ outcome: "REFER", engineOutcome: "AUTO_DECLINE", score: null });
    const refused = await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, { type: "APPROVE", rationale: "try" })
      .expect(409);
    expect(refused.body.detail).toMatch(/knockout/);
    const counter = await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "COUNTER_OFFER",
        amount: "30000.00",
        tenorMonths: 12,
        overrideReason: "OV04",
        rationale: "try smaller",
      })
      .expect(409);
    expect(counter.body.detail).toMatch(/knockout/);
    const unchanged = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(unchanged.status).toBe("REVIEW");
    expect(unchanged.recommendation).toBeNull();
    // The case view says the same before the officer tries: only a decline is accepted.
    expect(unchanged.recommendationTypes).toEqual([
      {
        type: "APPROVE",
        enabled: false,
        blockedBy: "INVALID_STATE_TRANSITION",
        detail: refused.body.detail,
      },
      {
        type: "COUNTER_OFFER",
        enabled: false,
        blockedBy: "INVALID_STATE_TRANSITION",
        detail: refused.body.detail,
      },
      { type: "DECLINE", enabled: true },
    ]);
    expect(unchanged.decidedDuringOutage).toBe(false);
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "DECLINE",
        overrideReason: "OV06",
        rationale: "Sanctions match",
      })
      .expect(200);
  });

  it("a product with no automation row runs off (fail safe)", async () => {
    await truncateGuarded(h.ds, ["automation_change", "automation_event"]);
    await h.ds.query("DELETE FROM product_automation WHERE product_code = 'PL'");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    expect(await decisionOf(c)).toMatchObject({
      automationMode: "OFF",
      engineOutcome: "AUTO_APPROVE",
    });
  });
});

describe("AU-3 the kill switch: on at once by one administrator, off only with a second", () => {
  it("routes every new application to a person until two administrators turn it off", async () => {
    const on = await h
      .as("leo")
      .post("/automation/PL/kill-switch", { reason: "Bureau data quality incident" })
      .expect(200);
    expect((on.body as AutomationView[])[0]).toMatchObject({
      mode: "LIVE",
      killSwitch: true,
      killSwitchSetByName: "Leo Santiago",
    });
    const again = await h
      .as("celia")
      .post("/automation/PL/kill-switch", { reason: "x" })
      .expect(409);
    expect(again.body.code).toBe("INVALID_STATE_TRANSITION");

    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(d).toMatchObject({ outcome: "REFER", killSwitch: true, automationMode: "LIVE" });
    expect(d.reasonCodes[0]?.code).toBe("R21");

    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "KILL_SWITCH_OFF", reason: "Resolved" })
      .expect(201);
    const pending = (await pl()).pendingChange;
    expect(pending).toMatchObject({ kind: "KILL_SWITCH_OFF", requestedMode: null });
    const own = await h
      .as("leo")
      .post(`/automation/PL/changes/${pending?.id}/approve`, {})
      .expect(403);
    expect(own.body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await pl()).killSwitch).toBe(true);
    await h.as("celia").post(`/automation/PL/changes/${pending?.id}/approve`, {}).expect(200);
    expect(await pl()).toMatchObject({ killSwitch: false, killSwitchSetByName: null });

    const after = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(after.status).toBe("OFFER");
    expect((await events()).map((e) => e.action)).toEqual([
      "KILL_SWITCH_OFF",
      "KILL_SWITCH_OFF_REQUESTED",
      "KILL_SWITCH_ON",
    ]);
  });

  it("the kill switch waits for a decision that has read the mode, and the decision keeps the mode it read", async () => {
    const automation = h.app.get(AutomationService);
    const qr = h.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // The decision's own read (DecisionService.decideAndRecord), under its share lock.
      expect(await automation.forDecision(qr.manager, "PL")).toEqual({
        mode: "LIVE",
        killSwitch: false,
      });
      let settled = false;
      const on = h
        .as("leo")
        .post("/automation/PL/kill-switch", { reason: "Incident" })
        .then((res) => {
          settled = true;
          return res;
        });
      // Give the request ample time to reach the lock; it must still be waiting.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
      // Within the open decision the mode it read is still the mode it sees.
      expect(await automation.forDecision(qr.manager, "PL")).toEqual({
        mode: "LIVE",
        killSwitch: false,
      });
      await qr.commitTransaction();
      expect((await on).status).toBe(200);
      expect((await pl()).killSwitch).toBe(true);
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
  });

  it("asking to turn off a switch that is off is refused", async () => {
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "KILL_SWITCH_OFF", reason: "x" })
      .expect(409);
    expect(await changes()).toBe(0);
  });
});

describe("TR-1 RS-PL-2 referral triggers through the API", () => {
  it("income mismatch (Dante), fraud flag (Paula) and related party (Teresa) each refer", async () => {
    for (const [applicantId, code, ruleId] of [
      ["APL-DANTE", "R15", "RF-INCOME"],
      ["APL-PAULA", "R16", "RF-FRAUD"],
      ["APL-NAVARRO", "R18", "RF-RELATED"],
    ] as const) {
      const c = await submitCase(h, { applicantId });
      expect(c.status).toBe("REVIEW");
      const d = await decisionOf(c);
      expect(d).toMatchObject({
        outcome: "REFER",
        score: 742,
        grade: "A",
        ruleSetVersion: "RS-PL-3",
      });
      expect(d.reasonCodes.map((r) => r.code)).toEqual([code]);
      expect(d.ruleResults.find((r) => r.id === ruleId)?.result).toBe("FAIL");
    }
  });

  it("a fraud check outage refers (R17), never declines; the case is re-decided once it answers", async () => {
    await setMode(h, "FRAUD", "OUTAGE");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(d).toMatchObject({ outcome: "REFER", score: 742 });
    expect(d.reasonCodes.map((r) => r.code)).toEqual(["R17"]);
    const view = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(view.decidedDuringOutage).toBe(true);
    expect(view.allowedActions).toContainEqual({ action: "REDECIDE", enabled: true });
    expect(view.recommendationTypes.filter((t) => t.enabled).map((t) => t.type)).toEqual([
      "DECLINE",
    ]);

    // Nothing decided without the fraud check may be approved.
    const refused = await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, { type: "APPROVE", rationale: "x" })
      .expect(409);
    expect(refused.body.detail).toMatch(/no fraud check/);
    const stillDown = await h.as("paolo").post(`/cases/${c.id}/redecide`).expect(503);
    expect(stillDown.body.detail).toMatch(/The fraud check still cannot answer/);

    await setMode(h, "FRAUD", "OK");
    const redecided = (await h.as("paolo").post(`/cases/${c.id}/redecide`).expect(200))
      .body as CaseDetail;
    expect(redecided.status).toBe("OFFER");
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM decision_record WHERE case_id = $1", [c.id]),
    ).toBe(2);
  });

  it("a malformed or slow fraud reply is also a referral", async () => {
    for (const mode of ["MALFORMED", "TIMEOUT"]) {
      await setMode(h, "FRAUD", mode);
      const c = await submitCase(h, { applicantId: "APL-MARIA" });
      expect(c.status).toBe("REVIEW");
      expect((await decisionOf(c)).reasonCodes.map((r) => r.code)).toEqual(["R17"]);
    }
  });
});

describe("TR-2 records made under RS-PL-1, before automation modes, still reproduce (ADR 0022)", () => {
  interface StoredRecord {
    name: string;
    inputs: unknown;
    inputsHash: string;
    ruleSetVersion: string;
    scorecardVersion: string;
    outcome: string;
    score: number | null;
    grade: string | null;
    ruleResults: unknown;
    scoreContributions: unknown;
    reasonCodes: unknown;
    referralTriggers: unknown;
    debtToIncome: string | null;
    monthlyRate: string | null;
  }
  // Frozen: captured from the engine before RS-PL-2 existed (packages/base D-14 replays the
  // same file). Never regenerated.
  const fixture = (
    JSON.parse(
      readFileSync(
        resolve(__dirname, "../../../packages/base/test/decisioning/fixtures/rs-pl-1-records.json"),
        "utf8",
      ),
    ) as { records: unknown }
  ).records as StoredRecord[];

  /** Store a record the way the RS-PL-1 code did, with the migration's backfill (LIVE, off). */
  async function storeOld(r: StoredRecord, automationMode = "LIVE"): Promise<string> {
    const applicantId = await twin(h, "APL-MARIA");
    const c = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId,
          amount: "150000.00",
          tenorMonths: 24,
          purpose: "Old record",
          submit: false,
          consent: FULL_CONSENT,
        })
        .expect(201)
    ).body as CaseDetail;
    const [row] = (await h.ds.query(
      `INSERT INTO decision_record (case_id, inputs, inputs_hash, rule_set_version, scorecard_version,
         outcome, score, grade, rule_results, score_contributions, reason_codes, referral_triggers,
         debt_to_income, monthly_rate, provider_mode, decided_by, automation_mode, kill_switch, engine_outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'SIMULATED', 'STF-PAOLO', $15, false, NULL)
       RETURNING id`,
      [
        c.id,
        JSON.stringify(r.inputs),
        r.inputsHash,
        r.ruleSetVersion,
        r.scorecardVersion,
        r.outcome,
        r.score,
        r.grade,
        JSON.stringify(r.ruleResults),
        JSON.stringify(r.scoreContributions),
        JSON.stringify(r.reasonCodes),
        JSON.stringify(r.referralTriggers),
        r.debtToIncome,
        r.monthlyRate,
        automationMode,
      ],
    )) as { id: string }[];
    return row?.id as string;
  }

  it.each(fixture.map((r) => [r.name, r] as const))(
    "the RS-PL-1 %s record reproduces with a match",
    async (_name, r) => {
      const id = await storeOld(r);
      const replay = (await h.as("diane").post(`/decisions/${id}/reproduce`).expect(200))
        .body as ReproduceResult;
      expect(replay).toEqual({
        decisionId: id,
        match: true,
        differences: [],
        inputsHashMatches: true,
      });
    },
  );

  it("the database refuses a record after RS-PL-1 without the engine's outcome", async () => {
    const r = fixture[0] as StoredRecord;
    await expect(
      h.ds.query(
        `INSERT INTO decision_record (case_id, inputs, inputs_hash, rule_set_version, scorecard_version,
           outcome, rule_results, score_contributions, reason_codes, referral_triggers,
           provider_mode, decided_by, automation_mode, kill_switch, engine_outcome)
         VALUES (gen_random_uuid(), $1, $2, 'RS-PL-2', 'SC-PL-1', 'REFER', '[]', '[]', '[]', '[]',
           'SIMULATED', 'STF-PAOLO', 'LIVE', false, NULL)`,
        [JSON.stringify(r.inputs), r.inputsHash],
      ),
    ).rejects.toThrow(/CHK_decision_record_engine_outcome/);
  });

  it("a mode column that disagrees with the snapshot is reported", async () => {
    const id = await storeOld(fixture[0] as StoredRecord, "SHADOW");
    const replay = (await h.as("diane").post(`/decisions/${id}/reproduce`).expect(200))
      .body as ReproduceResult;
    expect(replay).toMatchObject({ match: false, differences: ["automationMode"] });
  });

  it("a record naming a rule set this API does not know still shows its case, without a band", async () => {
    const id = await storeOld(fixture[0] as StoredRecord);
    const [{ case_id: caseId }] = (await h.ds.query(
      "SELECT case_id FROM decision_record WHERE id = $1",
      [id],
    )) as [{ case_id: string }];
    // A record from a newer deployment: rename its version by re-inserting it (records are
    // insert-only), then point the case at it.
    const [{ id: unknownId }] = (await h.ds.query(
      `INSERT INTO decision_record (case_id, inputs, inputs_hash, rule_set_version, scorecard_version,
         outcome, score, grade, rule_results, score_contributions, reason_codes, referral_triggers,
         debt_to_income, monthly_rate, provider_mode, decided_by, automation_mode, kill_switch, engine_outcome)
       SELECT case_id, inputs, inputs_hash, 'RS-PL-99', scorecard_version, outcome, score, grade,
         rule_results, score_contributions, reason_codes, referral_triggers, debt_to_income,
         monthly_rate, provider_mode, decided_by, automation_mode, kill_switch, outcome
       FROM decision_record WHERE id = $1 RETURNING id`,
      [id],
    )) as [{ id: string }];
    await h.ds.query("UPDATE loan_case SET decision_id = $2 WHERE id = $1", [caseId, unknownId]);
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const view = (await h.as("paolo").get(`/cases/${caseId}`).expect(200)).body as CaseDetail;
    expect(view.decision).toMatchObject({ ruleSetVersion: "RS-PL-99", scoreBand: null });
    const record = (await h.as("paolo").get(`/cases/${caseId}/decision`).expect(200)).body;
    expect(record).toMatchObject({ id: unknownId, scoreBand: null });
    expect(warn).toHaveBeenCalledWith(
      "Decision record names unknown rule set RS-PL-99; shown without a score band",
    );
    warn.mockRestore();
  });
});
