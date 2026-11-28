import { ExpiryService } from "@loan/base";
import type {
  ActivityView,
  ApplicantView,
  CaseDetail,
  CaseList,
  CoreCustomerView,
  LoanOfficerView,
} from "@loan/core";
import {
  count,
  FULL_CONSENT,
  type Harness,
  resetData,
  setMode,
  startHarness,
  submitCase,
} from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE sim.service_mode");
});

/** Joel, referred (REVIEW): a referral joins the team queue unassigned. */
const referred = () =>
  submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });

async function activity(id: string): Promise<ActivityView[]> {
  return (await h.as("diane").get(`/cases/${id}/activity`).expect(200)).body as ActivityView[];
}

const routingOf = async (id: string) => ({
  row: await h.ds.query("SELECT owner_id, priority, version FROM loan_case WHERE id = $1", [id]),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event WHERE case_id = $1", [id]),
});

const queue = async (persona: "paolo" | "joy", owner?: "me" | "unassigned") =>
  (
    (
      await h
        .as(persona)
        .get(`/cases?view=queue${owner ? `&owner=${owner}` : ""}`)
        .expect(200)
    ).body as CaseList
  ).items;

describe("queue routing (QR-1, PRD WF-002)", () => {
  it("QR-1 a draft is its capturer's; a referral joins the team queue unassigned with its channel and reason", async () => {
    const draft = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId: "APL-ANA",
          amount: "60000.00",
          tenorMonths: 12,
          purpose: "Home improvement",
          submit: false,
          consent: FULL_CONSENT,
        })
        .expect(201)
    ).body as CaseDetail;
    expect(draft).toMatchObject({
      ownerId: "STF-PAOLO",
      ownerName: "Paolo Tan",
      channel: "BRANCH",
      priority: "NORMAL",
      reason: null,
    });

    const c = await referred();
    expect(c).toMatchObject({ status: "REVIEW", ownerId: null, ownerName: null });
    expect(c.reason).toMatch(/thin|file/i);
    expect(c.allowedActions).toContainEqual({ action: "PICK", enabled: true });

    const unassigned = await queue("joy", "unassigned");
    expect(unassigned.map((x) => x.id)).toContain(c.id);
    expect(unassigned.map((x) => x.id)).not.toContain(draft.id);
    expect((await queue("paolo", "me")).map((x) => x.id)).toEqual([draft.id]);
  });

  it("QR-1 a loan officer picks an unassigned referral; a second pick is refused (409) and nothing changes", async () => {
    const c = await referred();
    const picked = (await h.as("joy").post(`/cases/${c.id}/pick`).expect(200)).body as CaseDetail;
    expect(picked).toMatchObject({ ownerId: "STF-JOY", ownerName: "Joy Dela Cruz" });
    expect(picked.allowedActions.map((a) => a.action)).not.toContain("PICK");
    expect((await queue("joy", "me")).map((x) => x.id)).toContain(c.id);
    expect((await activity(c.id)).find((e) => e.action === "CASE_PICKED")).toMatchObject({
      actorName: "Joy Dela Cruz",
    });

    const before = await routingOf(c.id);
    const res = await h.as("paolo").post(`/cases/${c.id}/pick`).expect(409);
    expect(res.body.detail).toMatch(/already owns/);
    expect(await routingOf(c.id)).toEqual(before);
  });

  it("QR-1 two officers picking at once: exactly one owns it", async () => {
    const c = await referred();
    const results = await Promise.all([
      h.as("paolo").post(`/cases/${c.id}/pick`),
      h.as("joy").post(`/cases/${c.id}/pick`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = (await activity(c.id)).filter((e) => e.action === "CASE_PICKED");
    expect(events).toHaveLength(1);
  });

  it("QR-1 reassign hands the case over with a reason and one event; bad targets and reasons are refused with nothing written", async () => {
    const c = await referred();
    await h.as("paolo").post(`/cases/${c.id}/pick`).expect(200);
    const before = await routingOf(c.id);
    const noReason = await h
      .as("paolo")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-JOY", reason: "  " })
      .expect(400);
    expect(noReason.body.errors).toEqual([
      { field: "reason", message: "Enter a reason for the reassignment." },
    ]);
    const notOfficer = await h
      .as("paolo")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-RINA", reason: "Leave." })
      .expect(400);
    expect(notOfficer.body.errors[0].field).toBe("ownerId");
    await h
      .as("paolo")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-PAOLO", reason: "Mine already." })
      .expect(409);
    expect(await routingOf(c.id)).toEqual(before);

    const moved = (
      await h
        .as("paolo")
        .post(`/cases/${c.id}/reassign`, { ownerId: "STF-JOY", reason: "On leave from Monday." })
        .expect(200)
    ).body as CaseDetail;
    expect(moved).toMatchObject({ ownerId: "STF-JOY", ownerName: "Joy Dela Cruz" });
    const event = (await activity(c.id)).find((e) => e.action === "CASE_REASSIGNED");
    expect(event).toMatchObject({
      summary: "Reassigned to Joy Dela Cruz: On leave from Monday.",
      details: { fromOwnerId: "STF-PAOLO", toOwnerId: "STF-JOY", reason: "On leave from Monday." },
    });

    const officers = (await h.as("paolo").get("/loan-officers").expect(200))
      .body as LoanOfficerView[];
    expect(officers.map((o) => o.fullName)).toEqual(["Joy Dela Cruz", "Paolo Tan"]);
    expect(officers.find((o) => o.id === "STF-JOY")?.openCases).toBeGreaterThanOrEqual(1);
  });

  it("QR-1 a high-priority case comes first in the queue; setting the same priority again is refused (409)", async () => {
    const first = await referred();
    const second = await referred();
    const res = await h
      .as("paolo")
      .post(`/cases/${second.id}/priority`, { priority: "HIGH" })
      .expect(200);
    expect((res.body as CaseDetail).priority).toBe("HIGH");
    const order = (await queue("paolo", "unassigned")).map((x) => x.id);
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(first.id));
    expect((await activity(second.id)).find((e) => e.action === "PRIORITY_CHANGED")).toMatchObject({
      summary: "Marked high priority.",
    });
    const before = await routingOf(second.id);
    await h.as("paolo").post(`/cases/${second.id}/priority`, { priority: "HIGH" }).expect(409);
    await h.as("paolo").post(`/cases/${second.id}/priority`, { priority: "URGENT" }).expect(400);
    expect(await routingOf(second.id)).toEqual(before);
  });

  it("QR-1 routing is refused once the case has left the loan officers (409), and returning it gives it back to the recommender", async () => {
    const c = await referred();
    await h.as("joy").post(`/cases/${c.id}/pick`).expect(200);
    const inApproval = (
      await h
        .as("paolo")
        .post(`/cases/${c.id}/recommendation`, {
          type: "COUNTER_OFFER",
          amount: "120000.00",
          tenorMonths: 36,
          overrideReason: "OV04",
          rationale: "Thin file.",
        })
        .expect(200)
    ).body as CaseDetail;
    expect(inApproval.status).toBe("APPROVAL");
    const before = await routingOf(c.id);
    await h.as("paolo").post(`/cases/${c.id}/pick`).expect(409);
    await h
      .as("paolo")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-JOY", reason: "x" })
      .expect(409);
    await h.as("paolo").post(`/cases/${c.id}/priority`, { priority: "HIGH" }).expect(409);
    expect(await routingOf(c.id)).toEqual(before);

    const returned = (await h.as("rina").post(`/cases/${c.id}/return`).expect(200))
      .body as CaseDetail;
    expect(returned).toMatchObject({ status: "REVIEW", ownerId: "STF-PAOLO" });
  });

  it("QR-1 routing never moves the waiting clock: picking keeps a referral's place, and reassigning a live draft does not extend it", async () => {
    const c = await referred();
    const clock = async (id: string) =>
      (
        (await h.ds.query("SELECT updated_at FROM loan_case WHERE id = $1", [id])) as {
          updated_at: Date;
        }[]
      )[0]?.updated_at.toISOString();
    const before = await clock(c.id);
    await h.as("joy").post(`/cases/${c.id}/pick`).expect(200);
    await h.as("joy").post(`/cases/${c.id}/priority`, { priority: "HIGH" }).expect(200);
    await h
      .as("joy")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-PAOLO", reason: "x" })
      .expect(200);
    expect(await clock(c.id)).toBe(before);
  });

  it("QR-1 an expired draft (not yet swept) cannot be reassigned or re-prioritised (409, clock unchanged); the sweep then expires it", async () => {
    const draft = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId: "APL-LIZA",
          amount: "60000.00",
          tenorMonths: 12,
          purpose: "Home improvement",
          submit: false,
          consent: FULL_CONSENT,
        })
        .expect(201)
    ).body as CaseDetail;
    await h.ds.query("UPDATE loan_case SET updated_at = now() - interval '31 days' WHERE id = $1", [
      draft.id,
    ]);
    const before = await routingOf(draft.id);
    const [{ updated_at: aged }] = await h.ds.query(
      "SELECT updated_at FROM loan_case WHERE id = $1",
      [draft.id],
    );
    const reassign = await h
      .as("paolo")
      .post(`/cases/${draft.id}/reassign`, { ownerId: "STF-JOY", reason: "Leave." })
      .expect(409);
    expect(reassign.body.detail).toMatch(/^This draft expired on /);
    await h.as("paolo").post(`/cases/${draft.id}/priority`, { priority: "HIGH" }).expect(409);
    expect(await routingOf(draft.id)).toEqual(before);
    const [{ updated_at: after }] = await h.ds.query(
      "SELECT updated_at FROM loan_case WHERE id = $1",
      [draft.id],
    );
    expect(after).toEqual(aged);
    await h.app.get(ExpiryService).expireStale(new Date());
    const [{ status }] = await h.ds.query("SELECT status FROM loan_case WHERE id = $1", [draft.id]);
    expect(status).toBe("EXPIRED");
  });

  it("QR-1 only loan officers route (403), and no session is 401", async () => {
    const c = await referred();
    const before = await routingOf(c.id);
    for (const persona of ["rina", "marco", "diane", "leo"] as const) {
      await h.as(persona).post(`/cases/${c.id}/pick`).expect(403);
      await h
        .as(persona)
        .post(`/cases/${c.id}/reassign`, { ownerId: "STF-JOY", reason: "x" })
        .expect(403);
      await h.as(persona).post(`/cases/${c.id}/priority`, { priority: "HIGH" }).expect(403);
      await h.as(persona).get("/loan-officers").expect(403);
    }
    await h.anonymous().post(`/cases/${c.id}/pick`).expect(401);
    expect(await routingOf(c.id)).toEqual(before);
  });
});

const NEW_CUSTOMER = {
  fullName: "Rogelio Santiago",
  birthDate: "1988-06-12",
  governmentIdLast4: "4410",
  employer: "Bulacan Hardware Trading",
  employmentMonths: 36,
  monthlyIncome: "52000.00",
  monthlyObligations: "6000.00",
};

describe("walk-in and core customer capture (WI-1, PRD INT-005, INT-002)", () => {
  // One person is on record once (WI-2): remove the walk-ins each test captured, with their
  // cases, so the next capture of the same synthetic person is not refused as already on file.
  afterEach(async () => {
    await resetData(h.ds);
    await h.ds.query("DELETE FROM applicant WHERE id LIKE 'APL-W%'");
  });

  it("WI-1 a walk-in new to the bank is captured by hand, then applied for like any applicant", async () => {
    const res = await h.as("paolo").post("/applicants", NEW_CUSTOMER).expect(201);
    const a = res.body as ApplicantView;
    expect(a).toMatchObject({
      fullName: "Rogelio Santiago",
      relationshipMonths: 0,
      monthlyIncome: "52000.00",
      depositAccount: "",
      governmentIdMasked: "•••• •••• 4410",
    });
    expect(a.id).toMatch(/^APL-W[0-9A-F]{10}$/);
    const listed = (await h.as("paolo").get("/applicants").expect(200)).body as ApplicantView[];
    expect(listed.map((x) => x.id)).toContain(a.id);

    // A new-to-bank applicant has no bureau file in the simulator: referred, never declined.
    const c = await submitCase(
      h,
      { applicantId: a.id, amount: "60000.00" },
      { sameApplicant: true },
    );
    expect(c.status).toBe("REVIEW");
    const [{ n }] = await h.ds.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE action = 'APPLICANT_CAPTURED' AND details->>'applicantId' = $1",
      [a.id],
    );
    expect(n).toBe(1);
  });

  it.each([
    ["no name", { ...NEW_CUSTOMER, fullName: " " }, "fullName"],
    ["a birth date in the future", { ...NEW_CUSTOMER, birthDate: "2999-01-01" }, "birthDate"],
    ["a malformed birth date", { ...NEW_CUSTOMER, birthDate: "12/06/1988" }, "birthDate"],
    [
      "an ID that is not 4 digits",
      { ...NEW_CUSTOMER, governmentIdLast4: "44A0" },
      "governmentIdLast4",
    ],
    [
      // A new-to-bank walk-in has no WhiteBank account: none may be typed in (another
      // customer's, here), so the disbursement account always comes from core.
      "a typed deposit account (another customer's)",
      { ...NEW_CUSTOMER, depositAccount: "WB-SAV-0245-1180" },
      // The field is not part of the request at all: the whitelist refuses it as an unknown property.
      "property",
    ],
    ["an amount Money cannot read", { ...NEW_CUSTOMER, monthlyIncome: "." }, "monthlyIncome"],
  ])("WI-1 refuses %s (400) and stores nothing", async (_label, body, field) => {
    const before = await count(h.ds, "SELECT count(*) AS n FROM applicant");
    const res = await h.as("paolo").post("/applicants", body).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    expect(await count(h.ds, "SELECT count(*) AS n FROM applicant")).toBe(before);
  });

  it("WI-1 an existing customer is pre-filled from simulated core; identity, account and relationship come from core, not the form", async () => {
    const found = (await h.as("paolo").get("/customers/cif-100245").expect(200))
      .body as CoreCustomerView;
    expect(found).toMatchObject({
      customerNumber: "CIF-100245",
      fullName: "Lorna Bautista",
      monthlyIncome: "64000.00",
      relationshipMonths: 61,
      depositAccount: "WB-SAV-0245-1180",
      providerMode: "SIMULATED",
      applicantId: null,
    });

    const res = await h
      .as("paolo")
      .post("/applicants", {
        ...NEW_CUSTOMER,
        customerNumber: "CIF-100245",
        fullName: "Someone Else",
        monthlyIncome: "70000.00",
      })
      .expect(201);
    const a = res.body as ApplicantView;
    expect(a).toMatchObject({
      fullName: "Lorna Bautista",
      relationshipMonths: 61,
      depositAccount: "WB-SAV-0245-1180",
      // Verified by core's salary credits; the declared 70,000 is kept for the income check.
      monthlyIncome: "64000.00",
    });
    const [row] = await h.ds.query(
      "SELECT customer_number, declared_monthly_income FROM applicant WHERE id = $1",
      [a.id],
    );
    expect(row).toEqual({ customer_number: "CIF-100245", declared_monthly_income: "70000.00" });

    // The same customer again: the unique index refuses it (409), naming the one on file.
    const again = await h
      .as("paolo")
      .post("/applicants", { ...NEW_CUSTOMER, customerNumber: "CIF-100245" })
      .expect(409);
    expect(again.body.detail).toContain(a.id);
    expect(
      ((await h.as("paolo").get("/customers/CIF-100245").expect(200)).body as CoreCustomerView)
        .applicantId,
    ).toBe(a.id);
  });

  it("WI-1 two captures of the same core customer at once store one applicant (the index decides)", async () => {
    const results = await Promise.all([
      h.as("paolo").post("/applicants", { ...NEW_CUSTOMER, customerNumber: "CIF-100388" }),
      h.as("joy").post("/applicants", { ...NEW_CUSTOMER, customerNumber: "CIF-100388" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM applicant WHERE customer_number = 'CIF-100388'"),
    ).toBe(1);
  });

  it("WI-1, WI-2 a walk-in re-capturing a sanctioned persona's identity is refused as that person already on file (409, naming them), not waved through", async () => {
    const before = await count(h.ds, "SELECT count(*) AS n FROM applicant");
    const res = await h
      .as("paolo")
      .post("/applicants", {
        ...NEW_CUSTOMER,
        fullName: "  ramon   CRUZ ",
        birthDate: "1974-06-20",
        governmentIdLast4: "1188",
      })
      .expect(409);
    // The officer is pointed at the record on file, whose screening declines (D-2).
    expect(res.body.detail).toContain("APL-RAMON");
    expect(await count(h.ds, "SELECT count(*) AS n FROM applicant")).toBe(before);
  });

  it("WI-1 a hand-captured walk-in is stored with no deposit account (the checklist refuses booking until core has one)", async () => {
    const a = (await h.as("paolo").post("/applicants", NEW_CUSTOMER).expect(201))
      .body as ApplicantView;
    expect(a.depositAccount).toBe("");
  });

  it("WI-1 an unknown customer number is 404 on lookup and a field error on capture", async () => {
    await h.as("paolo").get("/customers/CIF-999999").expect(404);
    const res = await h
      .as("paolo")
      .post("/applicants", { ...NEW_CUSTOMER, customerNumber: "CIF-999999" })
      .expect(400);
    expect(res.body.errors).toEqual([
      { field: "customerNumber", message: "Core banking has no customer with this number." },
    ]);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "WI-1 with the core lookup in %s, lookup and core capture answer 503 with nothing stored, and a manual capture still works",
    async (mode) => {
      await setMode(h, "CUSTOMER_LOOKUP", mode);
      const before = await count(h.ds, "SELECT count(*) AS n FROM applicant");
      const lookup = await h.as("paolo").get("/customers/CIF-100388").expect(503);
      expect(lookup.body.detail).toMatch(/Capture the applicant by hand/);
      await h
        .as("paolo")
        .post("/applicants", { ...NEW_CUSTOMER, customerNumber: "CIF-100388" })
        .expect(503);
      expect(await count(h.ds, "SELECT count(*) AS n FROM applicant")).toBe(before);
      await h.as("paolo").post("/applicants", NEW_CUSTOMER).expect(201);
    },
  );

  it("WI-1 only the loan officer captures or looks up (403), and no session is 401", async () => {
    for (const persona of ["rina", "marco", "diane", "leo"] as const) {
      await h.as(persona).post("/applicants", NEW_CUSTOMER).expect(403);
      await h.as(persona).get("/customers/CIF-100245").expect(403);
    }
    await h.anonymous().post("/applicants").send(NEW_CUSTOMER).expect(401);
    await h.anonymous().get("/customers/CIF-100245").expect(401);
  });
});
