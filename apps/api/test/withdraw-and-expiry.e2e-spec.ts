import { ExpiryService } from "@loan/base";
import type { ActivityView, CaseDetail } from "@loan/core";
import {
  count,
  FULL_CONSENT,
  type Harness,
  readyForChecker,
  setMode,
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

const WITHDRAW = { reasonCode: "APPLICANT_REQUEST", note: "  Found a cheaper loan elsewhere.  " };

/** A saved draft (with consent) for a new twin of Maria, or for the given applicant. */
async function draft(applicantId?: string): Promise<CaseDetail> {
  const res = await h
    .as("paolo")
    .post("/cases", {
      applicantId: applicantId ?? (await twin(h, "APL-MARIA")),
      amount: "60000.00",
      tenorMonths: 12,
      purpose: "Home improvement",
      submit: false,
      consent: FULL_CONSENT,
    })
    .expect(201);
  return res.body as CaseDetail;
}

/** Joel, referred (REVIEW). */
const inReview = () =>
  submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });

/** Joel, with a counter-offer in front of the approver (APPROVAL). */
async function inApproval(): Promise<CaseDetail> {
  const c = await inReview();
  const res = await h
    .as("paolo")
    .post(`/cases/${c.id}/recommendation`, {
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      overrideReason: "OV04",
      rationale: "Thin file.",
    })
    .expect(200);
  return res.body as CaseDetail;
}

/** Maria, auto-approved (OFFER). */
const inOffer = () =>
  submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00", tenorMonths: 12 });

async function activity(id: string): Promise<ActivityView[]> {
  return (await h.as("diane").get(`/cases/${id}/activity`).expect(200)).body as ActivityView[];
}

async function statusOf(id: string): Promise<string | undefined> {
  const rows = (await h.ds.query("SELECT status FROM loan_case WHERE id = $1", [id])) as {
    status: string;
  }[];
  return rows[0]?.status;
}

const sweep = (now = new Date()) => h.app.get(ExpiryService).expireStale(now);

/** Move a draft's last change, or an offer's date, `days` into the past. */
const ageDraft = (id: string, days: number) =>
  h.ds.query("UPDATE loan_case SET updated_at = now() - make_interval(days => $2) WHERE id = $1", [
    id,
    days,
  ]);
const ageOffer = (id: string, days: number) =>
  h.ds.query("UPDATE loan_case SET offered_at = now() - make_interval(days => $2) WHERE id = $1", [
    id,
    days,
  ]);

describe("withdraw (W-1, PRD WF-012)", () => {
  it.each([
    ["DRAFT", () => draft()],
    ["REVIEW", inReview],
    ["APPROVAL", inApproval],
    ["OFFER", inOffer],
  ] as const)(
    "W-1 the loan officer withdraws a case in %s, with a reason, in one event",
    async (from, make) => {
      const c = await make();
      expect(c.status).toBe(from);
      expect(c.allowedActions).toContainEqual({ action: "WITHDRAW", enabled: true });

      const res = await h.as("paolo").post(`/cases/${c.id}/withdraw`, WITHDRAW).expect(200);
      const after = res.body as CaseDetail;
      expect(after).toMatchObject({
        status: "WITHDRAWN",
        closedFrom: from,
        withdrawal: {
          reasonCode: "APPLICANT_REQUEST",
          note: "Found a cheaper loan elsewhere.",
          by: "STF-PAOLO",
          byName: "Paolo Tan",
        },
      });
      // Nothing left to do but read: only viewing the decision record (if any) is offered.
      expect(after.allowedActions.map((a) => a.action)).toEqual(
        from === "DRAFT" ? [] : ["REPRODUCE_DECISION"],
      );
      expect(Date.parse(after.withdrawal?.at ?? "")).not.toBeNaN();

      const events = (await activity(c.id)).filter((e) => e.action === "WITHDRAWN");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorName: "Paolo Tan",
        actorRole: "LOAN_OFFICER",
        fromStatus: from,
        toStatus: "WITHDRAWN",
        details: { reasonCode: "APPLICANT_REQUEST", note: "Found a cheaper loan elsewhere." },
      });
      expect(events[0]?.summary).toMatch(/Applicant withdrew/);
      // Compliance reads back the same withdrawal.
      const reread = (await h.as("diane").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
      expect(reread.withdrawal).toEqual(after.withdrawal);
    },
  );

  it("a note is optional", async () => {
    const c = await draft();
    const res = await h
      .as("paolo")
      .post(`/cases/${c.id}/withdraw`, { reasonCode: "DUPLICATE_APPLICATION" })
      .expect(200);
    expect(res.body).toMatchObject({
      status: "WITHDRAWN",
      withdrawal: { reasonCode: "DUPLICATE_APPLICATION", note: null },
    });
  });

  it.each(["BOOKING", "DISBURSED"] as const)(
    "is refused from %s with 409, and nothing changes",
    async (stage) => {
      const c = await inOffer();
      if (stage === "BOOKING") {
        await h.as("marco").post(`/cases/${c.id}/sign`).expect(200);
      } else {
        await readyForChecker(h, c.id);
        await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
      }
      const before = await activity(c.id);
      expect(await statusOf(c.id)).toBe(stage);

      const res = await h.as("paolo").post(`/cases/${c.id}/withdraw`, WITHDRAW).expect(409);
      expect(res.body).toMatchObject({ status: 409, code: "INVALID_STATE_TRANSITION" });
      expect(await statusOf(c.id)).toBe(stage);
      expect(await activity(c.id)).toHaveLength(before.length);
      const [row] = (await h.ds.query(
        "SELECT withdraw_reason, withdraw_note FROM loan_case WHERE id = $1",
        [c.id],
      )) as { withdraw_reason: string | null; withdraw_note: string | null }[];
      expect(row).toEqual({ withdraw_reason: null, withdraw_note: null });
    },
  );

  it("a withdrawn case cannot be withdrawn again, or submitted", async () => {
    const c = await draft();
    await h.as("paolo").post(`/cases/${c.id}/withdraw`, WITHDRAW).expect(200);
    await h.as("paolo").post(`/cases/${c.id}/withdraw`, WITHDRAW).expect(409);
    await h.as("paolo").post(`/cases/${c.id}/submit`).expect(409);
    expect(await statusOf(c.id)).toBe("WITHDRAWN");
    expect((await activity(c.id)).filter((e) => e.action === "WITHDRAWN")).toHaveLength(1);
  });

  it.each([
    ["no reason", {}],
    ["an unknown reason", { reasonCode: "CHANGED_MIND" }],
    ["a decline code", { reasonCode: "DR01" }],
    ["a note over 2000 characters", { reasonCode: "NOT_PROCEEDING", note: "x".repeat(2001) }],
    ["an unknown field", { reasonCode: "NOT_PROCEEDING", status: "DISBURSED" }],
  ])("%s is refused with 400, and the case does not change", async (_, body) => {
    const c = await draft();
    const res = await h.as("paolo").post(`/cases/${c.id}/withdraw`, body).expect(400);
    expect(res.body).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(await statusOf(c.id)).toBe("DRAFT");
    expect((await activity(c.id)).some((e) => e.action === "WITHDRAWN")).toBe(false);
  });

  it.each(["rina", "marco", "ella", "diane", "leo"] as const)(
    "%s (not a loan officer) gets 403, and the case does not change",
    async (persona) => {
      const c = await inApproval();
      const res = await h.as(persona).post(`/cases/${c.id}/withdraw`, WITHDRAW).expect(403);
      expect(res.body.code).toBe("FORBIDDEN_ROLE");
      expect(await statusOf(c.id)).toBe("APPROVAL");
      expect((await activity(c.id)).some((e) => e.action === "WITHDRAWN")).toBe(false);
    },
  );

  it("a withdrawn application no longer blocks a new one for the applicant (INT-007 index)", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const first = await draft(applicantId);
    // Still open: a second capture is refused.
    await h
      .as("paolo")
      .post("/cases", {
        applicantId,
        amount: "60000.00",
        tenorMonths: 12,
        purpose: "Home improvement",
        submit: false,
      })
      .expect(409);
    await h.as("paolo").post(`/cases/${first.id}/withdraw`, WITHDRAW).expect(200);
    const next = await draft(applicantId);
    expect(next).toMatchObject({ status: "DRAFT" });
    expect(next.reference).not.toBe(first.reference);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM loan_case WHERE applicant_id = $1", [
        applicantId,
      ]),
    ).toBe(2);
  });
});

describe("expiry (W-2, PRD INT-003)", () => {
  // The sweep is global: clear anything an earlier test left stale, so each test's counts are
  // its own cases only.
  beforeEach(async () => {
    await sweep();
  });
  afterEach(async () => {
    await h.ds.query("TRUNCATE sim.service_mode");
  });

  it("W-2 the sweep expires a draft unchanged for 30 days and an offer unsigned for 5, each with a SYSTEM event", async () => {
    const staleDraft = await draft();
    const staleOffer = await inOffer();
    const freshDraft = await draft();
    const freshOffer = await inOffer();
    const [{ offered_at }] = (await h.ds.query("SELECT offered_at FROM loan_case WHERE id = $1", [
      freshOffer.id,
    ])) as [{ offered_at: Date | null }];
    expect(offered_at).toBeInstanceOf(Date);
    await ageDraft(staleDraft.id, 31);
    await ageOffer(staleOffer.id, 6);
    await ageDraft(freshDraft.id, 29);
    await ageOffer(freshOffer.id, 4);
    // The next deadline is on the case: 30 days from the draft's last change, 5 from the offer.
    const fresh = (await h.as("paolo").get(`/cases/${freshDraft.id}`).expect(200))
      .body as CaseDetail;
    const daysLeft = (Date.parse(fresh.expiresAt ?? "") - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(0.9);
    expect(daysLeft).toBeLessThan(1.1);
    const offer = (await h.as("marco").get(`/cases/${freshOffer.id}`).expect(200))
      .body as CaseDetail;
    expect((Date.parse(offer.expiresAt ?? "") - Date.now()) / 86_400_000).toBeCloseTo(1, 1);

    expect(await sweep()).toEqual({ drafts: 1, offers: 1 });

    expect(await statusOf(staleDraft.id)).toBe("EXPIRED");
    expect(await statusOf(staleOffer.id)).toBe("EXPIRED");
    expect(await statusOf(freshDraft.id)).toBe("DRAFT");
    expect(await statusOf(freshOffer.id)).toBe("OFFER");
    for (const [c, from, summary] of [
      [staleDraft, "DRAFT", /Draft expired: unchanged for 30 days/],
      [staleOffer, "OFFER", /Offer expired: not signed within 5 days/],
    ] as const) {
      const events = (await activity(c.id)).filter((e) => e.action === "EXPIRED");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorRole: "SYSTEM",
        actorName: "Expiry sweep",
        fromStatus: from,
        toStatus: "EXPIRED",
      });
      expect(events[0]?.summary).toMatch(summary);
      const view = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
      expect(view).toMatchObject({ status: "EXPIRED", closedFrom: from, expiresAt: null });
      expect(view.allowedActions.every((a) => a.action === "REPRODUCE_DECISION")).toBe(true);
    }

    // Twice is safe: nothing more changes, and no second event is written.
    expect(await sweep()).toEqual({ drafts: 0, offers: 0 });
    expect((await activity(staleDraft.id)).filter((e) => e.action === "EXPIRED")).toHaveLength(1);
    expect(await statusOf(freshDraft.id)).toBe("DRAFT");
    expect(await statusOf(freshOffer.id)).toBe("OFFER");
  });

  it("an offer from an approver's approval carries its offer date and expires the same way", async () => {
    const c = await inApproval();
    await h.as("rina").post(`/cases/${c.id}/approve`).expect(200);
    await ageOffer(c.id, 6);
    expect(await sweep()).toEqual({ drafts: 0, offers: 1 });
    expect(await statusOf(c.id)).toBe("EXPIRED");
  });

  it("an offer made by re-deciding an outage referral carries its offer date and expires the same way", async () => {
    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    const referred = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(referred.status).toBe("REVIEW");
    await setMode(h, "CREDIT_BUREAU", "OK");
    const redecided = (await h.as("paolo").post(`/cases/${referred.id}/redecide`).expect(200))
      .body as CaseDetail;
    expect(redecided.status).toBe("OFFER");
    expect(redecided.expiresAt).not.toBeNull();
    await ageOffer(referred.id, 6);
    expect(await sweep()).toEqual({ drafts: 0, offers: 1 });
    expect(await statusOf(referred.id)).toBe("EXPIRED");
  });

  it("editing a stale draft (even consent only) is refused with 409 and nothing changes", async () => {
    const c = await draft();
    await ageDraft(c.id, 31);
    const before = (await h.ds.query(
      "SELECT updated_at, version, requested_amount FROM loan_case WHERE id = $1",
      [c.id],
    )) as unknown[];
    const consents = () =>
      count(h.ds, "SELECT count(*) AS n FROM consent_record WHERE case_id = $1", [c.id]);
    const consentsBefore = await consents();
    const eventsBefore = (await activity(c.id)).length;
    const view = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(view.allowedActions).toContainEqual(
      expect.objectContaining({ action: "EDIT_DRAFT", enabled: false }),
    );

    for (const body of [{ amount: "70000.00" }, { consent: FULL_CONSENT }]) {
      const res = await h.as("paolo").patch(`/cases/${c.id}`, body).expect(409);
      expect(res.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
      expect(res.body.detail).toMatch(/^This draft expired on \d{4}-\d{2}-\d{2}/);
    }
    expect(
      await h.ds.query(
        "SELECT updated_at, version, requested_amount FROM loan_case WHERE id = $1",
        [c.id],
      ),
    ).toEqual(before);
    expect(await consents()).toBe(consentsBefore);
    expect(await activity(c.id)).toHaveLength(eventsBefore);
    expect(await sweep()).toEqual({ drafts: 1, offers: 0 });
  });

  it("two sweeps at once expire each case once", async () => {
    const a = await draft();
    const b = await inOffer();
    await ageDraft(a.id, 40);
    await ageOffer(b.id, 10);
    const [first, second] = await Promise.all([sweep(), sweep()]);
    expect(first.drafts + second.drafts).toBe(1);
    expect(first.offers + second.offers).toBe(1);
    expect((await activity(a.id)).filter((e) => e.action === "EXPIRED")).toHaveLength(1);
    expect((await activity(b.id)).filter((e) => e.action === "EXPIRED")).toHaveLength(1);
  });

  it("signing a stale offer is refused with 409 before e-signature is called; the sweep then expires it", async () => {
    const c = await inOffer();
    await ageOffer(c.id, 6);
    const view = (await h.as("marco").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(view.allowedActions).toContainEqual(
      expect.objectContaining({ action: "SIGN", enabled: false }),
    );
    const res = await h.as("marco").post(`/cases/${c.id}/sign`).expect(409);
    expect(res.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(res.body.detail).toMatch(/^This offer expired on \d{4}-\d{2}-\d{2}/);
    expect(await statusOf(c.id)).toBe("OFFER");
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM sim.signature WHERE idempotency_key = $1", [
        `sig-${c.id}`,
      ]),
    ).toBe(0);
    expect(await sweep()).toEqual({ drafts: 0, offers: 1 });
    expect(await statusOf(c.id)).toBe("EXPIRED");
  });

  it("submitting a stale draft is refused with 409 and no decision is made; the sweep then expires it", async () => {
    const c = await draft();
    await ageDraft(c.id, 31);
    const view = (await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(view.allowedActions).toContainEqual(
      expect.objectContaining({ action: "SUBMIT", enabled: false }),
    );
    const res = await h.as("paolo").post(`/cases/${c.id}/submit`).expect(409);
    expect(res.body).toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(res.body.detail).toMatch(/^This draft expired on \d{4}-\d{2}-\d{2}/);
    expect(await statusOf(c.id)).toBe("DRAFT");
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM decision_record WHERE case_id = $1", [c.id]),
    ).toBe(0);
    expect(await sweep()).toEqual({ drafts: 1, offers: 0 });
    expect(await statusOf(c.id)).toBe("EXPIRED");
  });

  it("an expired application no longer blocks a new one for the applicant", async () => {
    const applicantId = await twin(h, "APL-MARIA");
    const first = await draft(applicantId);
    await ageDraft(first.id, 31);
    expect(await sweep()).toEqual({ drafts: 1, offers: 0 });
    const next = await draft(applicantId);
    expect(next.status).toBe("DRAFT");
  });

  it("the sweep leaves closed and in-progress cases alone however old they are", async () => {
    const withdrawn = await draft();
    await h.as("paolo").post(`/cases/${withdrawn.id}/withdraw`, WITHDRAW).expect(200);
    const review = await inReview();
    await h.ds.query(
      "UPDATE loan_case SET updated_at = now() - interval '90 days', offered_at = now() - interval '90 days' WHERE id = ANY($1)",
      [[withdrawn.id, review.id]],
    );
    expect(await sweep()).toEqual({ drafts: 0, offers: 0 });
    expect(await statusOf(withdrawn.id)).toBe("WITHDRAWN");
    expect(await statusOf(review.id)).toBe("REVIEW");
  });
});
