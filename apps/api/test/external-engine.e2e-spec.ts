import { AutomationService } from "@loan/base";
import { EXTERNAL_DECISION_ENGINE, type ExternalDecisionEngine } from "@loan/contracts";
import type {
  AutomationEventView,
  AutomationView,
  CaseDetail,
  DecisionRecordView,
  ProviderUsageView,
  ReproduceResult,
} from "@loan/core";
import {
  count,
  type Harness,
  resetData,
  setMode,
  startHarness,
  submitCase,
} from "./support/harness";

/**
 * The external decision engine option (PRD DEC-008; ACCEPTANCE EX-2, EX-3) through the real
 * API: the per-product role is maker-checker, a decision calls the simulated client engine
 * through the provider gateway, stores its answer in the snapshot and replays from it, and an
 * engine that cannot answer refers, never declines. Every test starts from PL live, no engine.
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

const pl = async (persona: "leo" | "celia" | "diane" = "leo"): Promise<AutomationView> => {
  const list = (await h.as(persona).get("/automation").expect(200)).body as AutomationView[];
  const view = list.find((v) => v.productCode === "PL");
  if (!view) throw new Error("no PL automation");
  return view;
};

/** Draft a role change as one administrator and approve it as the other. */
async function useExternal(role: "NONE" | "ALONGSIDE" | "INSTEAD"): Promise<void> {
  await h
    .as("leo")
    .post("/automation/PL/changes", {
      kind: "SET_EXTERNAL_ENGINE",
      externalEngine: role,
      reason: "test",
    })
    .expect(201);
  const pending = (await pl()).pendingChange;
  if (!pending) throw new Error("no pending change");
  await h.as("celia").post(`/automation/PL/changes/${pending.id}/approve`, {}).expect(200);
}

const decisionOf = async (c: CaseDetail) =>
  (await h.as("paolo").get(`/cases/${c.id}/decision`).expect(200)).body as DecisionRecordView;
const codes = (d: DecisionRecordView) => d.reasonCodes.map((r) => r.code);
const exRule = (d: DecisionRecordView) => d.ruleResults.find((r) => r.id === "EX-ENGINE");
const externalOf = (d: DecisionRecordView) => (d.inputs as { external?: unknown }).external;
const externalCalls = (caseId: string) =>
  count(
    h.ds,
    "SELECT count(*) AS n FROM provider_call WHERE service = 'EXTERNAL_DECISION' AND case_id = $1",
    [caseId],
  );
const reproduce = async (d: DecisionRecordView) =>
  (await h.as("diane").post(`/decisions/${d.id}/reproduce`).expect(200)).body as ReproduceResult;

describe("EX-2 the external engine's role is maker-checker between two administrators", () => {
  it("one administrator drafts, a different one approves; the history has before and after", async () => {
    expect((await pl()).externalEngine).toBe("NONE");
    const drafted = await h
      .as("leo")
      .post("/automation/PL/changes", {
        kind: "SET_EXTERNAL_ENGINE",
        externalEngine: "ALONGSIDE",
        reason: "Client pilot",
      })
      .expect(201);
    expect((drafted.body as AutomationView[])[0]).toMatchObject({
      externalEngine: "NONE",
      pendingChange: {
        kind: "SET_EXTERNAL_ENGINE",
        requestedExternalEngine: "ALONGSIDE",
        fromExternalEngine: "NONE",
        requestedMode: null,
      },
    });
    const id = (await pl()).pendingChange?.id;
    const own = await h.as("leo").post(`/automation/PL/changes/${id}/approve`, {}).expect(403);
    expect(own.body.code).toBe("MAKER_CHECKER_VIOLATION");
    for (const persona of ["diane", "paolo"] as const) {
      await h.as(persona).post(`/automation/PL/changes/${id}/approve`, {}).expect(403);
    }
    expect((await pl()).externalEngine).toBe("NONE");

    await h.as("celia").post(`/automation/PL/changes/${id}/approve`, {}).expect(200);
    expect(await pl("diane")).toMatchObject({ externalEngine: "ALONGSIDE", mode: "LIVE" });
    const history = (await h.as("diane").get("/automation/PL/history").expect(200))
      .body as AutomationEventView[];
    expect(history.map((e) => e.action)).toEqual([
      "EXTERNAL_ENGINE_CHANGED",
      "EXTERNAL_ENGINE_CHANGE_REQUESTED",
    ]);
    expect(history[0]?.details).toMatchObject({
      before: { externalEngine: "NONE", mode: "LIVE" },
      after: { externalEngine: "ALONGSIDE", mode: "LIVE" },
      reason: "Client pilot",
    });
  });

  it("refuses a role it already has, an unknown or missing role, mixed fields, and non-administrators", async () => {
    const draft = (body: object, persona: "leo" | "diane" | "paolo" = "leo") =>
      h.as(persona).post("/automation/PL/changes", { reason: "x", ...body });
    const same = await draft({ kind: "SET_EXTERNAL_ENGINE", externalEngine: "NONE" }).expect(400);
    expect(same.body.detail).toMatch(/already not used/);
    await draft({ kind: "SET_EXTERNAL_ENGINE", externalEngine: "SOMETIMES" }).expect(400);
    await draft({ kind: "SET_EXTERNAL_ENGINE" }).expect(400);
    await draft({ kind: "SET_MODE", mode: "OFF", externalEngine: "INSTEAD" }).expect(400);
    await draft({ kind: "SET_EXTERNAL_ENGINE", externalEngine: "INSTEAD", mode: "OFF" }).expect(
      400,
    );
    await draft({ kind: "SET_EXTERNAL_ENGINE", externalEngine: "INSTEAD" }, "diane").expect(403);
    await draft({ kind: "SET_EXTERNAL_ENGINE", externalEngine: "INSTEAD" }, "paolo").expect(403);
    expect(await count(h.ds, "SELECT count(*) AS n FROM automation_change")).toBe(0);
  });

  it("approval is refused when the role moved after the draft", async () => {
    await h
      .as("leo")
      .post("/automation/PL/changes", {
        kind: "SET_EXTERNAL_ENGINE",
        externalEngine: "INSTEAD",
        reason: "x",
      })
      .expect(201);
    const id = (await pl()).pendingChange?.id;
    await h.ds.query("UPDATE product_automation SET external_engine = 'ALONGSIDE'");
    const stale = await h.as("celia").post(`/automation/PL/changes/${id}/approve`, {}).expect(409);
    expect(stale.body.detail).toMatch(/role changed after this request was drafted/);
    expect((await pl()).externalEngine).toBe("ALONGSIDE");
  });

  it("a withdrawn or rejected role change leaves the role as it was, with both in the history", async () => {
    const draft = () =>
      h
        .as("leo")
        .post("/automation/PL/changes", {
          kind: "SET_EXTERNAL_ENGINE",
          externalEngine: "INSTEAD",
          reason: "x",
        })
        .expect(201);
    await draft();
    let id = (await pl()).pendingChange?.id;
    await h.as("leo").post(`/automation/PL/changes/${id}/reject`, {}).expect(200);
    expect(await pl()).toMatchObject({ externalEngine: "NONE", pendingChange: null });
    await draft();
    id = (await pl()).pendingChange?.id;
    await h
      .as("celia")
      .post(`/automation/PL/changes/${id}/reject`, { note: "not yet" })
      .expect(200);
    expect(await pl()).toMatchObject({ externalEngine: "NONE", pendingChange: null });

    const history = (await h.as("diane").get("/automation/PL/history").expect(200))
      .body as AutomationEventView[];
    expect(history.map((e) => e.action)).toEqual([
      "CHANGE_REJECTED",
      "EXTERNAL_ENGINE_CHANGE_REQUESTED",
      "CHANGE_WITHDRAWN",
      "EXTERNAL_ENGINE_CHANGE_REQUESTED",
    ]);
    expect(history[0]?.summary).toMatch(
      /change the external decision engine from not used to instead of the built-in engine/,
    );
    expect(history[0]?.details).toMatchObject({
      before: { externalEngine: "NONE" },
      after: { externalEngine: "NONE" },
      note: "not yet",
    });
    const statuses = (await h.ds.query(
      "SELECT status FROM automation_change ORDER BY requested_at",
    )) as { status: string }[];
    expect(statuses.map((s) => s.status)).toEqual(["WITHDRAWN", "REJECTED"]);
  });

  it("a role approval waits for a decision that has read the role, and the decision keeps the role it read", async () => {
    await h
      .as("leo")
      .post("/automation/PL/changes", {
        kind: "SET_EXTERNAL_ENGINE",
        externalEngine: "INSTEAD",
        reason: "x",
      })
      .expect(201);
    const id = (await pl()).pendingChange?.id;
    const automation = h.app.get(AutomationService);
    const qr = h.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // The decision's own read (DecisionService.decideAndRecord), under its share lock.
      expect((await automation.forDecision(qr.manager, "PL")).externalEngine).toBe("NONE");
      let settled = false;
      const approval = h
        .as("celia")
        .post(`/automation/PL/changes/${id}/approve`, {})
        .then((res) => {
          settled = true;
          return res;
        });
      // Give the request ample time to reach the lock; it must still be waiting.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
      expect((await automation.forDecision(qr.manager, "PL")).externalEngine).toBe("NONE");
      await qr.commitTransaction();
      expect((await approval).status).toBe(200);
      expect((await pl()).externalEngine).toBe("INSTEAD");
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
  });
});

describe("EX-3 a decision calls the external engine, stores its answer and replays from it", () => {
  it("not used: no call, the snapshot says NONE, and the outcome is the built-in one", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("OFFER");
    const d = await decisionOf(c);
    expect(d.ruleSetVersion).toBe("RS-PL-4");
    expect(externalOf(d)).toEqual({ role: "NONE" });
    expect(exRule(d)).toBeUndefined();
    expect(await externalCalls(c.id)).toBe(0);
  });

  it("alongside, agreeing (Maria): approved, the answer and its reference in the snapshot, one paid call", async () => {
    await useExternal("ALONGSIDE");
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(c.status).toBe("OFFER");
    const d = await decisionOf(c);
    expect(externalOf(d)).toMatchObject({
      role: "ALONGSIDE",
      status: "OK",
      decision: "APPROVE",
      reasonCodes: [],
      reference: expect.stringMatching(/^EXT-[0-9A-F]{12}$/),
    });
    expect(exRule(d)?.result).toBe("PASS");
    // The decision view says who else decided, for the panel.
    expect(d.externalEngine).toMatchObject({
      role: "ALONGSIDE",
      outcome: "AUTO_APPROVE",
      agreed: true,
    });
    expect(await externalCalls(c.id)).toBe(1);
    const usage = (await h.as("diane").get("/providers/usage").expect(200))
      .body as ProviderUsageView;
    expect(usage.services.find((s) => s.service === "EXTERNAL_DECISION")).toMatchObject({
      ok: 1,
      cost: "15.00",
    });
    expect(await reproduce(d)).toMatchObject({ match: true, inputsHashMatches: true });
  });

  it("alongside, disagreeing (Joel's thin file, which the client engine approves): a person decides (R23)", async () => {
    await useExternal("ALONGSIDE");
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(codes(d)[0]).toBe("R23");
    expect(codes(d)).toContain("R01");
    expect(d.engineOutcome).toBe("REFER");
    expect(d.externalEngine).toMatchObject({ outcome: "AUTO_APPROVE", agreed: false });
    expect(await reproduce(d)).toMatchObject({ match: true });
  });

  it("instead (Joel): the client engine's approval stands, priced from the built-in grade", async () => {
    await useExternal("INSTEAD");
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(c.status).toBe("OFFER");
    const d = await decisionOf(c);
    expect(d).toMatchObject({ outcome: "AUTO_APPROVE", reasonCodes: [] });
    expect(d.grade).not.toBeNull();
    expect(d.monthlyRate).not.toBeNull();
    expect(await reproduce(d)).toMatchObject({ match: true });
  });

  it("instead, a knockout (Ramon's sanctions match) still declines", async () => {
    await useExternal("INSTEAD");
    const c = await submitCase(h, {
      applicantId: "APL-RAMON",
      amount: "50000.00",
      tenorMonths: 12,
    });
    expect(c.status).toBe("DECLINED");
    expect(codes(await decisionOf(c))).toEqual(["R11"]);
  });

  it("instead, a client decline while the bureau is down refers (the outage first, then R25), never declines", async () => {
    await useExternal("INSTEAD");
    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    // The simulated client engine refers without a score; a real one might decline. Stand in
    // for one that does, for this call only.
    const engine = h.app.get<ExternalDecisionEngine>(EXTERNAL_DECISION_ENGINE);
    const spy = jest.spyOn(engine, "evaluate").mockResolvedValueOnce({
      provider: "Client decision engine (simulated)",
      mode: "SIMULATED",
      decision: "DECLINE",
      reasonCodes: ["EXT-NO-SCORE"],
      reference: "EXT-STUBBED0001",
      decidedAt: new Date().toISOString(),
    });
    try {
      const c = await submitCase(h, { applicantId: "APL-MARIA" });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ bureauScore: null }));
      expect(c.status).toBe("REVIEW");
      const d = await decisionOf(c);
      expect(d).toMatchObject({ outcome: "REFER", engineOutcome: "REFER" });
      expect(codes(d)).toEqual(["R10", "R25"]);
      expect(d.externalEngine).toMatchObject({ role: "INSTEAD", outcome: "AUTO_DECLINE" });
      expect(await reproduce(d)).toMatchObject({ match: true });
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ["ALONGSIDE", "OUTAGE"],
    ["ALONGSIDE", "MALFORMED"],
    ["INSTEAD", "OUTAGE"],
    ["INSTEAD", "MALFORMED"],
  ] as const)(
    "%s, an engine in %s refers (R22), never declines; the case is re-decided once it answers",
    async (role, mode) => {
      await useExternal(role);
      await setMode(h, "EXTERNAL_DECISION", mode);
      const c = await submitCase(h, { applicantId: "APL-MARIA" });
      expect(c.status).toBe("REVIEW");
      const d = await decisionOf(c);
      expect(codes(d)[0]).toBe("R22");
      expect(externalOf(d)).toMatchObject({ role, status: "UNAVAILABLE" });
      expect(d.externalEngine).toEqual({ role, outcome: null, reference: null, agreed: null });
      // Tried three times with backoff (PR-1), every attempt counted.
      expect(await externalCalls(c.id)).toBe(3);
      const view = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
      expect(view.decidedDuringOutage).toBe(true);
      const stillDown = await h.as("paolo").post(`/cases/${c.id}/redecide`).expect(503);
      expect(stillDown.body.detail).toMatch(/The external decision engine still cannot answer/);

      await setMode(h, "EXTERNAL_DECISION", "OK");
      const redecided = (await h.as("paolo").post(`/cases/${c.id}/redecide`).expect(200))
        .body as CaseDetail;
      expect(redecided.status).toBe("OFFER");
    },
  );
});
