import { CasesRepository, DecisionService, SEED_TEST_PASSWORD } from "@loan/base";
import type { ActivityView, CaseDetail } from "@loan/core";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import {
  FULL_CONSENT,
  type Harness,
  STAFF,
  startHarness,
  submitCase,
  twin,
} from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

/** Joel, referred, with a recommendation in front of the approver. */
async function inApproval(
  type: "COUNTER_OFFER" | "DECLINE" = "COUNTER_OFFER",
): Promise<CaseDetail> {
  const c = await submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });
  const body =
    type === "DECLINE"
      ? { type, overrideReason: "OV04", rationale: "Income cannot be verified." }
      : {
          type,
          amount: "120000.00",
          tenorMonths: 36,
          overrideReason: "OV04",
          rationale: "Thin file.",
        };
  const res = await h.as("paolo").post(`/cases/${c.id}/recommendation`, body).expect(200);
  expect(res.body.status).toBe("APPROVAL");
  return res.body as CaseDetail;
}

async function activity(id: string): Promise<ActivityView[]> {
  return (await h.as("diane").get(`/cases/${id}/activity`).expect(200)).body as ActivityView[];
}

describe("approver decline and return (APPROVAL → DECLINED | REVIEW)", () => {
  it("an approver declines with a reason code; the case is DECLINED and the event is recorded", async () => {
    const c = await inApproval();
    const res = await h
      .as("rina")
      .post(`/cases/${c.id}/decline`, { reasonCode: "DR04", note: "Recent delinquencies." })
      .expect(200);
    expect(res.body.status).toBe("DECLINED");
    const declined = (await activity(c.id)).find((e) => e.action === "DECLINED");
    expect(declined).toMatchObject({
      fromStatus: "APPROVAL",
      toStatus: "DECLINED",
      actorName: "Rina Aquino",
    });
  });

  it("a decline without a valid reason code is refused and the case does not change", async () => {
    const c = await inApproval();
    const res = await h
      .as("rina")
      .post(`/cases/${c.id}/decline`, { reasonCode: "NOPE" })
      .expect(400);
    expect(res.body).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect((await h.as("rina").get(`/cases/${c.id}`).expect(200)).body.status).toBe("APPROVAL");
  });

  it("an approver returns the case to review; the officer can recommend again", async () => {
    const c = await inApproval();
    const res = await h.as("rina").post(`/cases/${c.id}/return`).expect(200);
    expect(res.body.status).toBe("REVIEW");
    const returned = (await activity(c.id)).find((e) => e.action === "RETURNED");
    expect(returned).toMatchObject({
      fromStatus: "APPROVAL",
      toStatus: "REVIEW",
      details: { escalationCleared: false },
    });
    expect(returned?.summary).not.toMatch(/escalation/);
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "COUNTER_OFFER",
        amount: "100000.00",
        tenorMonths: 24,
        overrideReason: "OV04",
        rationale: "Smaller amount after review.",
      })
      .expect(200);
  });

  it("returning an escalated case clears the escalation, and the event says so", async () => {
    const c = await inApproval();
    await h.as("ben").post(`/cases/${c.id}/approve`).expect(403);
    expect((await h.as("rina").get(`/cases/${c.id}`).expect(200)).body.escalated).toBe(true);
    const res = await h.as("rina").post(`/cases/${c.id}/return`).expect(200);
    expect(res.body).toMatchObject({ status: "REVIEW", escalated: false });
    const returned = (await activity(c.id)).find((e) => e.action === "RETURNED");
    expect(returned).toMatchObject({ details: { escalationCleared: true } });
    expect(returned?.summary).toMatch(/escalation is cleared/);

    // The next recommendation is a new approval request: refused above Ben's authority again,
    // it is escalated again, with a second ESCALATED event.
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "COUNTER_OFFER",
        amount: "120000.00",
        tenorMonths: 36,
        overrideReason: "OV04",
        rationale: "Same terms after the approver's questions.",
      })
      .expect(200);
    await h.as("ben").post(`/cases/${c.id}/approve`).expect(403);
    expect((await h.as("rina").get(`/cases/${c.id}`).expect(200)).body.escalated).toBe(true);
    const escalations = (await activity(c.id)).filter((e) => e.action === "ESCALATED");
    expect(escalations).toHaveLength(2);
  });

  it("the loan officer and compliance cannot decline or return", async () => {
    const c = await inApproval();
    for (const persona of ["paolo", "diane"] as const) {
      for (const [path, body] of [
        ["decline", { reasonCode: "DR01" }],
        ["return", {}],
      ] as const) {
        const res = await h.as(persona).post(`/cases/${c.id}/${path}`, body).expect(403);
        expect(res.body.code).toBe("FORBIDDEN_ROLE");
      }
    }
    expect((await h.as("rina").get(`/cases/${c.id}`).expect(200)).body.status).toBe("APPROVAL");
  });

  it("a recommendation to decline cannot be approved; it must be declined or returned", async () => {
    const c = await inApproval("DECLINE");
    const res = await h.as("rina").post(`/cases/${c.id}/approve`).expect(409);
    expect(res.body.code).toBe("INVALID_STATE_TRANSITION");
    const after = (await h.as("rina").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(after).toMatchObject({ status: "APPROVAL", approved: null });
  });
});

describe("the session is re-checked against the staff table on every request", () => {
  it("a validly signed token for a staff id with no row gets 401", async () => {
    const jwt = h.app.get(JwtService);
    // Control: the same kind of token for a real staff id is accepted.
    const valid = await jwt.signAsync({ sub: STAFF.paolo }, { expiresIn: 60 });
    const ok = await request(h.app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${valid}`)
      .expect(200);
    expect(ok.body.id).toBe(STAFF.paolo);
    const token = await jwt.signAsync({ sub: "STF-GONE" }, { expiresIn: 60 });
    const res = await request(h.app.getHttpServer())
      .get("/cases")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("a staff member whose role changed loses the old role's access at once", async () => {
    await h.ds.query("UPDATE staff SET role = 'COMPLIANCE' WHERE id = $1", [STAFF.paolo]);
    try {
      const res = await h
        .as("paolo")
        .post("/cases", {
          applicantId: await twin(h, "APL-MARIA"),
          amount: "60000.00",
          tenorMonths: 12,
          purpose: "x",
        })
        .expect(403);
      expect(res.body.code).toBe("FORBIDDEN_ROLE");
    } finally {
      await h.ds.query("UPDATE staff SET role = 'LOAN_OFFICER' WHERE id = $1", [STAFF.paolo]);
    }
    await h.as("paolo").get("/cases?view=queue").expect(200);
  });
});

describe("test sign-in (Program Mechanics 1a)", () => {
  const signIn = (username: string, password: string) =>
    request(h.app.getHttpServer()).post("/auth/sign-in").send({ username, password });

  it("signs in with a seeded username and its test password, case-insensitively", async () => {
    const res = await signIn("Rina", SEED_TEST_PASSWORD).expect(200);
    expect(res.body).toMatchObject({ id: STAFF.rina, username: "rina", role: "APPROVER" });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);
  });

  it("a wrong password and an unknown username get the same 401", async () => {
    const wrong = await signIn("rina", "not-her-password").expect(401);
    const unknown = await signIn("nobody", "whatever").expect(401);
    expect(wrong.body).toMatchObject({
      code: "UNAUTHENTICATED",
      detail: "The username or password is not correct.",
    });
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("sign-in is throttled per username: the 21st wrong guess in a minute gets 429, other accounts still work", async () => {
    for (let i = 0; i < 20; i++) await signIn("mallory", `guess-${i}`).expect(401);
    const limited = await signIn("mallory", "guess-21").expect(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    const other = await signIn("diane", SEED_TEST_PASSWORD).expect(200);
    expect(other.body.username).toBe("diane");
  });

  it("there is no password-less sign-in route", async () => {
    await request(h.app.getHttpServer())
      .post("/auth/demo-login")
      .send({ staffId: STAFF.ella })
      .expect(404);
  });

  it("no public endpoint lists the staff accounts", async () => {
    await request(h.app.getHttpServer()).get("/auth/personas").expect(404);
  });

  it("the signed-in user's own view never carries a password or hash", async () => {
    const res = await h.as("ella").get("/auth/me").expect(200);
    expect(res.body).toMatchObject({ username: "ella", role: "LOAN_OPERATIONS_SUPERVISOR" });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash|Password123/);
  });

  it("stores each test password only as a scrypt hash", async () => {
    const rows = (await h.ds.query("SELECT password_hash FROM staff")) as {
      password_hash: string;
    }[];
    expect(rows.length).toBe(10);
    for (const r of rows) expect(r.password_hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    // One shared test password, but every row has its own salt, so no two hashes match.
    expect(new Set(rows.map((r) => r.password_hash)).size).toBe(rows.length);
  });
});

describe("the session cookie", () => {
  it("is httpOnly and SameSite=Lax, and carries only the staff id", async () => {
    const res = await request(h.app.getHttpServer())
      .post("/auth/sign-in")
      .send({ username: "paolo", password: SEED_TEST_PASSWORD })
      .expect(200);
    const cookie = ([] as string[])
      .concat(res.headers["set-cookie"] ?? [])
      .find((c) => c.startsWith("session="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // Tests run outside production, so the cookie is not Secure here (app.module.ts).
    expect(cookie).not.toMatch(/;\s*Secure/i);
    const token = (cookie as string).split(";")[0]?.slice("session=".length) as string;
    const payload = h.app.get(JwtService).decode(token) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
  });
});

describe("request hygiene", () => {
  it("a malformed JSON body gets a 400 problem body, not an HTML page", async () => {
    const res = await h
      .as("paolo")
      .post("/cases")
      .set("Content-Type", "application/json")
      .send('{"amount": ')
      .expect(400);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 400 });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });
});

describe("submit decides the draft it read (data review: submit race)", () => {
  it("a draft edited while its inputs are being gathered is refused, not decided on stale terms", async () => {
    const draft = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId: await twin(h, "APL-MARIA"),
          amount: "150000.00",
          tenorMonths: 24,
          purpose: "Home improvement",
          submit: false,
          consent: FULL_CONSENT,
        })
        .expect(201)
    ).body as CaseDetail;

    const decisions = h.app.get(DecisionService);
    const original = decisions.gatherInputs.bind(decisions);
    const spy = jest.spyOn(decisions, "gatherInputs").mockImplementationOnce(async (c, date) => {
      const inputs = await original(c, date);
      // The officer edits the draft while the bureau is answering.
      await h.as("paolo").patch(`/cases/${draft.id}`, { amount: "490000.00" }).expect(200);
      return inputs;
    });
    try {
      const res = await h.as("paolo").post(`/cases/${draft.id}/submit`).expect(409);
      expect(res.body.code).toBe("INVALID_STATE_TRANSITION");
    } finally {
      spy.mockRestore();
    }
    const after = (await h.as("paolo").get(`/cases/${draft.id}`).expect(200)).body as CaseDetail;
    expect(after).toMatchObject({ status: "DRAFT", requestedAmount: "490000.00" });
    expect(after.decision).toBeNull();
    // Submitted again, it is decided on the terms it now has.
    const decided = (await h.as("paolo").post(`/cases/${draft.id}/submit`).expect(200))
      .body as CaseDetail;
    expect(decided.status).toBe("REVIEW");
  });
});

describe("sign-in source cap (last in this file: it uses up this address's sign-in budget)", () => {
  it("rotating usernames from one address reaches 429", async () => {
    let limited = false;
    for (let i = 0; i < 61 && !limited; i++) {
      const res = await request(h.app.getHttpServer())
        .post("/auth/sign-in")
        .send({ username: `spray-${i}`, password: "guess" });
      expect([401, 429]).toContain(res.status);
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
  });
});

describe("consent before the bureau check (C-1, PRD INT-006 / AIS-002)", () => {
  const draft = async (consent?: object) =>
    (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId: await twin(h, "APL-MARIA"),
          amount: "60000.00",
          tenorMonths: 12,
          purpose: "Home improvement",
          submit: false,
          ...(consent ? { consent } : {}),
        })
        .expect(201)
    ).body as CaseDetail;
  const decisions = (id: string) =>
    h.ds
      .query("SELECT count(*)::int AS n FROM decision_record WHERE case_id = $1", [id])
      .then((r: { n: number }[]) => r[0]?.n);

  it("C-1 a draft without consent cannot be submitted: 400 on the consent field, no decision, still a draft", async () => {
    const d = await draft();
    expect(d.consent).toBeNull();
    const res = await h.as("paolo").post(`/cases/${d.id}/submit`).expect(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain("consent");
    expect(await decisions(d.id)).toBe(0);
    expect((await h.as("paolo").get(`/cases/${d.id}`).expect(200)).body.status).toBe("DRAFT");
  });

  it("a partial consent is recorded but does not allow submitting", async () => {
    const d = await draft({ ...FULL_CONSENT, creditBureauCheck: false });
    expect(d.consent).toMatchObject({
      creditBureauCheck: false,
      dataProcessing: true,
      complete: false,
    });
    await h.as("paolo").post(`/cases/${d.id}/submit`).expect(400);
    expect(await decisions(d.id)).toBe(0);
  });

  it("consent for anything but the current terms is refused, and nothing is created", async () => {
    const before = (await h.as("paolo").get("/cases?view=all").expect(200)).body.items.length;
    const res = await h
      .as("paolo")
      .post("/cases", {
        applicantId: await twin(h, "APL-MARIA"),
        amount: "60000.00",
        tenorMonths: 12,
        purpose: "Home improvement",
        submit: false,
        consent: { ...FULL_CONSENT, termsVersion: "0.9" },
      })
      .expect(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      "consent.termsVersion",
    );
    expect((await h.as("paolo").get("/cases?view=all").expect(200)).body.items.length).toBe(before);
  });

  it("consent recorded on a draft lets it be submitted; the case shows who captured it, and when", async () => {
    const d = await draft();
    const patched = (
      await h.as("paolo").patch(`/cases/${d.id}`, { consent: FULL_CONSENT }).expect(200)
    ).body as CaseDetail;
    expect(patched.consent).toMatchObject({
      creditBureauCheck: true,
      dataProcessing: true,
      termsVersion: FULL_CONSENT.termsVersion,
      channel: "BRANCH_ASSISTED",
      capturedBy: STAFF.paolo,
      capturedByName: "Paolo Tan",
      complete: true,
    });
    expect(Date.parse(patched.consent?.capturedAt ?? "")).not.toBeNaN();
    const submitted = (await h.as("paolo").post(`/cases/${d.id}/submit`).expect(200))
      .body as CaseDetail;
    expect(submitted.status).toBe("OFFER");
    const history = (await h.as("diane").get(`/cases/${d.id}/activity`).expect(200)).body as {
      action: string;
      details: Record<string, unknown>;
    }[];
    expect(history).toContainEqual(
      expect.objectContaining({
        action: "CONSENT_RECORDED",
        details: expect.objectContaining({ creditBureauCheck: true, dataProcessing: true }),
      }),
    );
  });

  it("a correction is a new record: the latest consent applies, and the records cannot be edited or deleted", async () => {
    const d = await draft(FULL_CONSENT);
    await h
      .as("paolo")
      .patch(`/cases/${d.id}`, { consent: { ...FULL_CONSENT, dataProcessing: false } })
      .expect(200);
    const view = (await h.as("paolo").get(`/cases/${d.id}`).expect(200)).body as CaseDetail;
    expect(view.consent).toMatchObject({ dataProcessing: false, complete: false });
    await h.as("paolo").post(`/cases/${d.id}/submit`).expect(400);
    const rows = (await h.ds.query(
      "SELECT count(*)::int AS n FROM consent_record WHERE case_id = $1",
      [d.id],
    )) as { n: number }[];
    expect(rows[0]?.n).toBe(2);
    await expect(
      h.ds.query("UPDATE consent_record SET data_processing = true WHERE case_id = $1", [d.id]),
    ).rejects.toThrow(/insert-only/);
    await expect(
      h.ds.query("DELETE FROM consent_record WHERE case_id = $1", [d.id]),
    ).rejects.toThrow(/insert-only/);
  });

  it("consent withdrawn while the providers answer stops the decision (re-read under the lock)", async () => {
    const d = await draft(FULL_CONSENT);
    const decisions_ = h.app.get(DecisionService);
    const original = decisions_.gatherInputs.bind(decisions_);
    const spy = jest.spyOn(decisions_, "gatherInputs").mockImplementationOnce(async (c, date) => {
      const inputs = await original(c, date);
      await h
        .as("paolo")
        .patch(`/cases/${d.id}`, { consent: { ...FULL_CONSENT, dataProcessing: false } })
        .expect(200);
      return inputs;
    });
    try {
      const res = await h.as("paolo").post(`/cases/${d.id}/submit`).expect(400);
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain("consent");
    } finally {
      spy.mockRestore();
    }
    expect(await decisions(d.id)).toBe(0);
    expect((await h.as("paolo").get(`/cases/${d.id}`).expect(200)).body.status).toBe("DRAFT");
  });

  it("capture-and-submit without full consent is refused before anything is stored", async () => {
    const before = (await h.as("paolo").get("/cases?view=all").expect(200)).body.items.length;
    const res = await h
      .as("paolo")
      .post("/cases", {
        applicantId: await twin(h, "APL-MARIA"),
        amount: "60000.00",
        tenorMonths: 12,
        purpose: "Home improvement",
        submit: true,
        consent: { ...FULL_CONSENT, creditBureauCheck: false },
      })
      .expect(400);
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain("consent");
    expect((await h.as("paolo").get("/cases?view=all").expect(200)).body.items.length).toBe(before);
  });

  it("allowedActions offers SUBMIT disabled, with the reason, until consent is complete", async () => {
    const d = await draft();
    expect(d.allowedActions).toContainEqual(
      expect.objectContaining({ action: "SUBMIT", enabled: false, blockedBy: "VALIDATION_FAILED" }),
    );
    const after = (
      await h.as("paolo").patch(`/cases/${d.id}`, { consent: FULL_CONSENT }).expect(200)
    ).body as CaseDetail;
    expect(after.allowedActions).toContainEqual({ action: "SUBMIT", enabled: true });
  });

  it("consent cannot be recorded on a submitted case, and nothing is written", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await h.as("paolo").patch(`/cases/${c.id}`, { consent: FULL_CONSENT }).expect(409);
    const rows = (await h.ds.query(
      "SELECT count(*)::int AS n FROM consent_record WHERE case_id = $1",
      [c.id],
    )) as { n: number }[];
    expect(rows[0]?.n).toBe(1);
  });

  it("only the loan officer records consent (it rides on capture and draft edits)", async () => {
    const d = await draft();
    const res = await h.as("rina").patch(`/cases/${d.id}`, { consent: FULL_CONSENT }).expect(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    expect((await h.as("paolo").get(`/cases/${d.id}`).expect(200)).body.consent).toBeNull();
  });
});

describe("one open application per applicant and product (A-7, PRD INT-007)", () => {
  const capture = (applicantId: string) =>
    h.as("paolo").post("/cases", {
      applicantId,
      amount: "60000.00",
      tenorMonths: 12,
      purpose: "Home improvement",
      submit: false,
    });
  const openCases = (applicantId: string) =>
    h.ds
      .query(
        "SELECT count(*)::int AS n FROM loan_case WHERE applicant_id = $1 AND status NOT IN ('DECLINED', 'DISBURSED')",
        [applicantId],
      )
      .then((r: { n: number }[]) => r[0]?.n);

  it("A-7 a second open application is refused with 409 naming the open case, and nothing is stored", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const first = (await capture(applicantId).expect(201)).body as CaseDetail;
    const res = await capture(applicantId).expect(409);
    expect(res.body).toMatchObject({ code: "DUPLICATE_APPLICATION", status: 409 });
    expect(res.body.detail).toContain(first.reference);
    expect(res.body.detail).toMatch(/Maria Santos already has an open personal loan application/);
    expect(await openCases(applicantId)).toBe(1);
  });

  it("a declined application does not block a new one", async () => {
    const applicantId = await twin(h, "APL-RAMON");
    const declined = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId,
          amount: "50000.00",
          tenorMonths: 12,
          purpose: "Home improvement",
          submit: true,
          consent: FULL_CONSENT,
        })
        .expect(201)
    ).body as CaseDetail;
    expect(declined.status).toBe("DECLINED");
    const next = (await capture(applicantId).expect(201)).body as CaseDetail;
    expect(next.status).toBe("DRAFT");
    expect(next.reference).not.toBe(declined.reference);
    expect(await openCases(applicantId)).toBe(1);
  });

  it("a disbursed loan does not block a new application", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const first = (await capture(applicantId).expect(201)).body as CaseDetail;
    // Stand-in for a completed booking (the full path is covered by F1 and B-1..B-8).
    await h.ds.query("UPDATE loan_case SET status = 'DISBURSED' WHERE id = $1", [first.id]);
    const next = (await capture(applicantId).expect(201)).body as CaseDetail;
    expect(next).toMatchObject({ status: "DRAFT" });
    expect(next.reference).not.toBe(first.reference);
    expect(await openCases(applicantId)).toBe(1);
  });

  it("when the pre-check misses a concurrent winner, the index refusal still answers 409 naming it", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const first = (await capture(applicantId).expect(201)).body as CaseDetail;
    const repo = h.app.get(CasesRepository);
    const original = repo.findOpenCase.bind(repo);
    // The pre-check sees nothing (as if the winner had not committed yet); the index refuses.
    const spy = jest.spyOn(repo, "findOpenCase").mockResolvedValueOnce(null);
    try {
      const res = await capture(applicantId).expect(409);
      expect(res.body.code).toBe("DUPLICATE_APPLICATION");
      expect(res.body.detail).toContain(first.reference);
    } finally {
      spy.mockRestore();
    }
    expect(await original(applicantId, "PL")).toMatchObject({ id: first.id });
    expect(await openCases(applicantId)).toBe(1);
  });

  it("two captures at once make exactly one open application (the database index holds the race)", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const results = await Promise.all([capture(applicantId), capture(applicantId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = results.find((r) => r.status === 409);
    expect(refused?.body.code).toBe("DUPLICATE_APPLICATION");
    expect(await openCases(applicantId)).toBe(1);
  });
});
