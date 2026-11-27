import { DecisionService } from "@loan/base";
import type { ActivityView, CaseDetail } from "@loan/core";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { type Harness, STAFF, startHarness, submitCase } from "./support/harness";

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
    expect(returned).toMatchObject({ fromStatus: "APPROVAL", toStatus: "REVIEW" });
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
          applicantId: "APL-MARIA",
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

describe("the session cookie", () => {
  it("is httpOnly and SameSite=Lax, and carries only the staff id", async () => {
    const res = await request(h.app.getHttpServer())
      .post("/auth/demo-login")
      .send({ staffId: STAFF.paolo })
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
          applicantId: "APL-MARIA",
          amount: "150000.00",
          tenorMonths: 24,
          purpose: "Home improvement",
          submit: false,
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
