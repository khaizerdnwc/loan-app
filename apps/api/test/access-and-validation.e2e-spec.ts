import type { CaseDetail, CaseList } from "@loan/core";
import {
  FULL_CONSENT,
  type Harness,
  readyForChecker,
  startHarness,
  submitCase,
  twin,
} from "./support/harness";

let h: Harness;
let joel: CaseDetail;
beforeAll(async () => {
  h = await startHarness();
  joel = await submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });
  await h
    .as("paolo")
    .post(`/cases/${joel.id}/recommendation`, {
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      overrideReason: "OV04",
      rationale: "Thin file.",
    })
    .expect(200);
});
afterAll(async () => {
  await h.close();
});

describe("roles and segregation of duties (backend-enforced)", () => {
  it("R-1 a loan officer cannot approve, and the case does not change", async () => {
    const res = await h.as("paolo").post(`/cases/${joel.id}/approve`).expect(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN_ROLE", status: 403 });
    expect((await h.as("paolo").get(`/cases/${joel.id}`).expect(200)).body.status).toBe("APPROVAL");
  });

  it("R-2 an approver cannot touch booking", async () => {
    for (const path of ["sign", "booking", "booking/approve"]) {
      const res = await h.as("rina").post(`/cases/${joel.id}/${path}`).expect(403);
      expect(res.body.code).toBe("FORBIDDEN_ROLE");
    }
  });

  it("R-3 no session gets 401 on every non-public endpoint", async () => {
    const anon = h.anonymous();
    for (const [method, path] of [
      ["get", "/cases"],
      ["get", `/cases/${joel.id}`],
      ["post", "/cases"],
      ["post", `/cases/${joel.id}/approve`],
      ["get", "/simulation/services"],
    ] as const) {
      const res = await anon[method](path).expect(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
    const health = await anon.get("/health").expect(200);
    expect(health.body).toEqual({ status: "ok" });
  });

  it("R-6 Ben (₱100,000, grades A–B) is refused on a ₱120,000 grade C case; it is escalated; Rina can approve", async () => {
    const view = (await h.as("ben").get(`/cases/${joel.id}`).expect(200)).body as CaseDetail;
    expect(view.allowedActions).toContainEqual(
      expect.objectContaining({
        action: "APPROVE",
        enabled: false,
        blockedBy: "AUTHORITY_LIMIT_EXCEEDED",
      }),
    );
    const refused = await h.as("ben").post(`/cases/${joel.id}/approve`).expect(403);
    expect(refused.body.code).toBe("AUTHORITY_LIMIT_EXCEEDED");
    expect(refused.body.detail).toMatch(/above your approval limit of ₱100000.00.*grade C/);
    const after = (await h.as("rina").get(`/cases/${joel.id}`).expect(200)).body as CaseDetail;
    expect(after).toMatchObject({ status: "APPROVAL", escalated: true });
    const history = (await h.as("rina").get(`/cases/${joel.id}/activity`).expect(200)).body as {
      action: string;
      actorName: string;
    }[];
    expect(history).toContainEqual(
      expect.objectContaining({ action: "ESCALATED", actorName: "Ben Castro" }),
    );
    const benQueue = (await h.as("ben").get("/cases?view=queue").expect(200)).body as CaseList;
    expect(benQueue.items.map((i) => i.id)).not.toContain(joel.id);
    const rinaQueue = (await h.as("rina").get("/cases?view=queue").expect(200)).body as CaseList;
    expect(rinaQueue.items.map((i) => i.id)).toContain(joel.id);
    await h.as("rina").post(`/cases/${joel.id}/approve`).expect(200);
  });

  it("R-5 the supervisor who submitted a booking cannot approve it; another supervisor can", async () => {
    await readyForChecker(h, joel.id, "ella");
    const view = (await h.as("ella").get(`/cases/${joel.id}`).expect(200)).body as CaseDetail;
    expect(view.allowedActions).toContainEqual(
      expect.objectContaining({
        action: "APPROVE_BOOKING",
        enabled: false,
        blockedBy: "MAKER_CHECKER_VIOLATION",
      }),
    );
    const refused = await h.as("ella").post(`/cases/${joel.id}/booking/approve`).expect(403);
    expect(refused.body.code).toBe("MAKER_CHECKER_VIOLATION");
    const ok = await h.as("lito").post(`/cases/${joel.id}/booking/approve`).expect(200);
    expect(ok.body.status).toBe("DISBURSED");
  });

  it("R-7 compliance reads every case and history but every write is refused", async () => {
    const all = (await h.as("diane").get("/cases?view=all").expect(200)).body as CaseList;
    expect(all.items.length).toBeGreaterThan(0);
    const history = (await h.as("diane").get(`/cases/${joel.id}/activity`).expect(200)).body as {
      action: string;
    }[];
    expect(history.map((e) => e.action)).toContain("CASE_CREATED");
    const id = joel.id;
    for (const [method, path] of [
      ["post", "/cases"],
      ["patch", `/cases/${id}`],
      ["post", `/cases/${id}/submit`],
      ["post", `/cases/${id}/recommendation`],
      ["post", `/cases/${id}/approve`],
      ["post", `/cases/${id}/decline`],
      ["post", `/cases/${id}/return`],
      ["post", `/cases/${id}/withdraw`],
      ["post", `/cases/${id}/sign`],
      ["post", `/cases/${id}/booking`],
      ["post", `/cases/${id}/booking/approve`],
      ["post", `/cases/${id}/info-request`],
      ["post", `/cases/${id}/pick`],
      ["post", `/cases/${id}/reassign`],
      ["post", `/cases/${id}/priority`],
      ["post", "/applicants"],
      ["post", `/cases/${id}/documents/BANK_STATEMENTS_3M/upload`],
      ["post", `/cases/${id}/documents/BANK_STATEMENTS_3M/review`],
      ["put", "/simulation/services/CREDIT_BUREAU"],
    ] as const) {
      const res = await h.as("diane")[method](path, {}).expect(403);
      expect(res.body.code).toBe("FORBIDDEN_ROLE");
    }
  });

  it("a case outside a role's view answers 404, not 403", async () => {
    const draft = await h
      .as("paolo")
      .post("/cases", {
        applicantId: await twin(h, "APL-MARIA"),
        amount: "50000.00",
        tenorMonths: 12,
        purpose: "Tuition",
        submit: false,
      })
      .expect(201);
    const res = await h.as("marco").get(`/cases/${draft.body.id}`).expect(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("the admin sees no cases and only the admin can switch a simulator", async () => {
    const res = await h.as("leo").get("/cases").expect(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    const refused = await h
      .as("paolo")
      .put("/simulation/services/CREDIT_BUREAU", { mode: "OUTAGE" })
      .expect(403);
    expect(refused.body.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("application capture and validation", () => {
  it.each([
    ["19999.99", 12, "amount"],
    ["500000.01", 12, "amount"],
    ["150000.00", 5, "tenorMonths"],
    ["150000.00", 37, "tenorMonths"],
  ])(
    "A-1/A-2 rejects amount %s over %i months with a field error, and stores nothing",
    async (amount, tenorMonths, field) => {
      const before = (await h.as("paolo").get("/cases?view=all").expect(200)).body.items.length;
      const res = await h
        .as("paolo")
        .post("/cases", {
          applicantId: await twin(h, "APL-MARIA"),
          amount,
          tenorMonths,
          purpose: "Test",
          submit: true,
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
      expect((await h.as("paolo").get("/cases?view=all").expect(200)).body.items.length).toBe(
        before,
      );
    },
  );

  it("A-2 rejects a tenor that is not a whole number", async () => {
    const res = await h
      .as("paolo")
      .post("/cases", {
        applicantId: await twin(h, "APL-MARIA"),
        amount: "50000.00",
        tenorMonths: 12.5,
        purpose: "Test",
        submit: true,
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it.each([
    [{ amount: "50000.00", tenorMonths: 12, purpose: "x", submit: true }, "applicantId"],
    [{ applicantId: "APL-MARIA", tenorMonths: 12, purpose: "x", submit: true }, "amount"],
    [{ applicantId: "APL-MARIA", amount: "50000.00", purpose: "x", submit: true }, "tenorMonths"],
    [
      {
        applicantId: "APL-MARIA",
        amount: "50000.00",
        tenorMonths: 12,
        purpose: "  ",
        submit: true,
      },
      "purpose",
    ],
    [
      { applicantId: "APL-MARIA", amount: 50000, tenorMonths: 12, purpose: "x", submit: true },
      "amount",
    ],
  ])("A-3 rejects an incomplete application %#", async (body, field) => {
    const res = await h.as("paolo").post("/cases", body).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body.errors)).toContain(field);
  });

  it("refuses unknown fields in a body", async () => {
    const res = await h
      .as("paolo")
      .post("/cases", {
        applicantId: await twin(h, "APL-MARIA"),
        amount: "50000.00",
        tenorMonths: 12,
        purpose: "x",
        submit: false,
        status: "DISBURSED",
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("A-4 a saved draft and a submitted case read back the same after reloading", async () => {
    const created = await h
      .as("paolo")
      .post("/cases", {
        applicantId: await twin(h, "APL-MARIA"),
        amount: "75000.50",
        tenorMonths: 18,
        purpose: "Car repair",
        submit: false,
      })
      .expect(201);
    const reloaded = (await h.as("paolo").get(`/cases/${created.body.id}`).expect(200))
      .body as CaseDetail;
    expect(reloaded).toMatchObject({
      status: "DRAFT",
      requestedAmount: "75000.50",
      requestedTenorMonths: 18,
      purpose: "Car repair",
    });
    const edited = await h
      .as("paolo")
      .patch(`/cases/${created.body.id}`, { amount: "80000.00", consent: FULL_CONSENT })
      .expect(200);
    expect(edited.body.requestedAmount).toBe("80000.00");
    const submitted = await h.as("paolo").post(`/cases/${created.body.id}/submit`).expect(200);
    const again = (await h.as("paolo").get(`/cases/${created.body.id}`).expect(200))
      .body as CaseDetail;
    expect(again).toMatchObject({
      status: submitted.body.status,
      requestedAmount: "80000.00",
      reference: submitted.body.reference,
    });
    await h.as("paolo").post(`/cases/${created.body.id}/submit`).expect(409);
  });
});
