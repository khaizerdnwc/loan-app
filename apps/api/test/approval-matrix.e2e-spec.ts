import type { ActivityView, ApprovalLevelView, CaseDetail, CaseList, StaffView } from "@loan/core";
import { count, type Harness, startHarness, submitCase } from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
// Tests that change an approver's level put it back, whatever happens in them.
afterEach(async () => {
  await h.ds.query("UPDATE staff SET approval_level = 'L2' WHERE id = 'STF-RINA'");
});

async function recommend(id: string, body: object): Promise<CaseDetail> {
  return (await h.as("paolo").post(`/cases/${id}/recommendation`, body).expect(200))
    .body as CaseDetail;
}

const queueIds = async (persona: "rina" | "teo" | "ben") =>
  ((await h.as(persona).get("/cases?view=queue").expect(200)).body as CaseList).items.map(
    (c) => c.id,
  );

const stateOf = async (id: string) =>
  h.ds.query("SELECT status, approved_by, approved_amount FROM loan_case WHERE id = $1", [id]);

describe("the approval matrix (AM-1, PRD WF-004)", () => {
  it("AM-1 is data: three delegated levels by product, amount, grade and exception, each with its approvers, readable by every role", async () => {
    const levels = (await h.as("diane").get("/approval-matrix").expect(200))
      .body as ApprovalLevelView[];
    expect(levels).toEqual([
      {
        code: "L1",
        name: "Approver (junior)",
        productCode: "PL",
        rank: 1,
        maxAmount: "100000.00",
        grades: ["A", "B"],
        exceptions: [],
        approvers: [{ fullName: "Ben Castro" }],
      },
      {
        code: "L2",
        name: "Approver",
        productCode: "PL",
        rank: 2,
        maxAmount: "1000000.00",
        grades: ["A", "B", "C"],
        exceptions: ["OVERRIDE"],
        approvers: [{ fullName: "Rina Aquino" }],
      },
      {
        code: "L3",
        name: "Head of credit",
        productCode: "PL",
        rank: 3,
        maxAmount: "3000000.00",
        grades: ["A", "B", "C", "D"],
        exceptions: ["OVERRIDE", "POLICY_EXCEPTION", "RELATED_PARTY"],
        approvers: [{ fullName: "Teodoro Lim" }],
      },
    ]);
    for (const persona of ["paolo", "rina", "marco", "leo"] as const) {
      await h.as(persona).get("/approval-matrix").expect(200);
    }
    await h.anonymous().get("/approval-matrix").expect(401);
    const me = (await h.as("rina").get("/auth/me").expect(200)).body as StaffView;
    expect(me).toMatchObject({
      approvalLevel: { code: "L2", name: "Approver" },
      approvalLimit: "1000000.00",
      approvalGrades: ["A", "B", "C"],
    });
  });

  it("AM-1 a policy exception is beyond L2: Rina is refused (403, nothing approved, case escalated) and the case is routed to L3, where the head of credit approves it", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    const inApproval = await recommend(c.id, {
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      overrideReason: "OV05",
      rationale: "Approved by credit policy as an exception.",
    });
    expect(inApproval.approvalRoute).toEqual({
      exceptions: ["OVERRIDE", "POLICY_EXCEPTION"],
      level: { code: "L3", name: "Head of credit" },
    });
    expect(await queueIds("rina")).not.toContain(c.id);
    expect(await queueIds("ben")).not.toContain(c.id);
    expect(await queueIds("teo")).toContain(c.id);

    const asRina = (await h.as("rina").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(asRina.allowedActions).toContainEqual(
      expect.objectContaining({
        action: "APPROVE",
        enabled: false,
        blockedBy: "AUTHORITY_LIMIT_EXCEEDED",
        escalates: true,
      }),
    );
    const before = await stateOf(c.id);
    const refused = await h.as("rina").post(`/cases/${c.id}/approve`).expect(403);
    expect(refused.body.code).toBe("AUTHORITY_LIMIT_EXCEEDED");
    expect(refused.body.detail).toBe(
      "a policy exception is not delegated to L2. Route it to L3 · Head of credit or above.",
    );
    expect(await stateOf(c.id)).toEqual(before);
    const [{ escalated }] = await h.ds.query("SELECT escalated FROM loan_case WHERE id = $1", [
      c.id,
    ]);
    expect(escalated).toBe(true);

    const approved = (await h.as("teo").post(`/cases/${c.id}/approve`).expect(200))
      .body as CaseDetail;
    expect(approved).toMatchObject({
      status: "OFFER",
      approved: { by: "STF-TEO", amount: "120000.00" },
    });
    expect(approved.approvalRoute).toBeNull();
  });

  it("AM-1 a related-party loan needs a level delegated it, even inside L2's amount and grades", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-NAVARRO",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(c.status).toBe("REVIEW");
    const inApproval = await recommend(c.id, {
      type: "APPROVE",
      rationale: "Related party, terms at arm's length.",
    });
    expect(inApproval.approvalRoute).toEqual({
      exceptions: ["RELATED_PARTY"],
      level: { code: "L3", name: "Head of credit" },
    });
    const refused = await h.as("rina").post(`/cases/${c.id}/approve`).expect(403);
    expect(refused.body.detail).toMatch(/^a related-party loan is not delegated to L2\./);
    await h.as("teo").post(`/cases/${c.id}/approve`).expect(200);
  });

  it("AM-1 an ordinary override stays within L2; amount, grade and exception all bound L1 (R-6 unchanged)", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await recommend(c.id, {
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      overrideReason: "OV04",
      rationale: "Lower exposure.",
    });
    const ben = await h.as("ben").post(`/cases/${c.id}/approve`).expect(403);
    expect(ben.body.detail).toBe(
      "₱120000.00 is above your approval limit of ₱100000.00, and grade C is outside the grades you may approve (A, B), and an override of the automated decision is not delegated to L1. Route it to L2 · Approver or above.",
    );
    const events = (
      (await h.as("diane").get(`/cases/${c.id}/activity`).expect(200)).body as ActivityView[]
    ).filter((e) => e.action === "ESCALATED");
    expect(events).toHaveLength(1);
    await h.as("rina").post(`/cases/${c.id}/approve`).expect(200);
  });

  it("AM-1 an approver with no level cannot approve at all", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    await recommend(c.id, { type: "APPROVE", rationale: "As requested." });
    await h.ds.query("UPDATE staff SET approval_level = NULL WHERE id = 'STF-RINA'");
    const view = (await h.as("rina").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    const approve = view.allowedActions.find((a) => a.action === "APPROVE");
    // Nothing to escalate to from no level: not offered as clickable.
    expect(approve).toMatchObject({ enabled: false, blockedBy: "AUTHORITY_LIMIT_EXCEEDED" });
    expect(approve).not.toHaveProperty("escalates");
    const res = await h.as("rina").post(`/cases/${c.id}/approve`).expect(403);
    expect(res.body.detail).toBe(
      "You hold no level in the approval matrix, so you cannot approve.",
    );
    expect(
      await count(
        h.ds,
        "SELECT count(*) AS n FROM loan_case WHERE id = $1 AND status = 'APPROVAL' AND NOT escalated",
        [c.id],
      ),
    ).toBe(1);
  });

  it("AM-1 a case no level covers (grade E) cannot be approved by anyone: APPROVE is refused, decline and return are offered and work", async () => {
    const declined = await submitCase(h, {
      applicantId: "APL-NINA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(declined).toMatchObject({ status: "REVIEW", grade: "E" });
    const c = await recommend(declined.id, { type: "APPROVE", rationale: "Long tenure at work." });
    expect(c.approvalRoute).toEqual({ exceptions: [], level: null });
    for (const persona of ["rina", "ben", "teo"] as const) {
      expect(await queueIds(persona)).not.toContain(c.id);
    }
    const asTeo = (await h.as("teo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    const approve = asTeo.allowedActions.find((a) => a.action === "APPROVE");
    expect(approve).toMatchObject({ enabled: false, blockedBy: "AUTHORITY_LIMIT_EXCEEDED" });
    expect(approve).not.toHaveProperty("escalates");
    expect(asTeo.allowedActions).toContainEqual({ action: "DECLINE", enabled: true });
    expect(asTeo.allowedActions).toContainEqual({ action: "RETURN", enabled: true });
    const snapshot = async () =>
      (
        await h.ds.query(
          "SELECT status, approved_by, approved_amount, escalated FROM loan_case WHERE id = $1",
          [c.id],
        )
      )[0];
    const before = await snapshot();
    const refused = await h.as("teo").post(`/cases/${c.id}/approve`).expect(403);
    expect(refused.body.detail).toMatch(
      /No level of the approval matrix covers it: decline it or return it/,
    );
    // Refused with nowhere to escalate: nothing changes, and the case is not flagged escalated.
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.escalated).toBe(false);
    const done = (
      await h.as("teo").post(`/cases/${c.id}/decline`, { reasonCode: "DR04" }).expect(200)
    ).body as CaseDetail;
    expect(done.status).toBe("DECLINED");

    const other = await submitCase(h, {
      applicantId: "APL-NINA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await recommend(other.id, { type: "APPROVE", rationale: "Long tenure at work." });
    const back = (await h.as("teo").post(`/cases/${other.id}/return`).expect(200))
      .body as CaseDetail;
    expect(back.status).toBe("REVIEW");
  });
});
