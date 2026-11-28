import type { ActivityView, CaseDetail } from "@loan/core";
import { count, type Harness, setMode, startHarness, submitCase } from "./support/harness";

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

const REQUEST = {
  documents: ["BANK_STATEMENTS_3M", "CERTIFICATE_OF_EMPLOYMENT"],
  message: "Hi Joel, please upload your last 3 months of bank statements and a COE.",
  dueInDays: 3,
};

/** Joel, referred (REVIEW). */
const inReview = () =>
  submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });

async function infoRequested(): Promise<CaseDetail> {
  const c = await inReview();
  const res = await h.as("paolo").post(`/cases/${c.id}/info-request`, REQUEST).expect(200);
  return res.body as CaseDetail;
}

const upload = (id: string, type: string) =>
  h.as("paolo").post(`/cases/${id}/documents/${type}/upload`);
const review = (id: string, type: string, body: object) =>
  h.as("paolo").post(`/cases/${id}/documents/${type}/review`, body);
const uploadsFor = (id: string) =>
  count(h.ds, "SELECT count(*) AS n FROM sim.document_upload WHERE application_id = $1", [id]);

async function activity(id: string): Promise<ActivityView[]> {
  return (await h.as("diane").get(`/cases/${id}/activity`).expect(200)).body as ActivityView[];
}

/** Everything a refused call must leave as it was. */
const snapshot = async (id: string) => ({
  case: await h.ds.query(
    "SELECT status, version, info_request_message, info_request_due FROM loan_case WHERE id = $1",
    [id],
  ),
  documents: await h.ds.query(
    "SELECT document_type, status, attempt, upload_reference, version FROM case_document WHERE case_id = $1 ORDER BY document_type",
    [id],
  ),
  events: await count(h.ds, "SELECT count(*) AS n FROM activity_event WHERE case_id = $1", [id]),
});

/** The business date (UTC+8) `days` from now, as the API computes the due date. */
const dueIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);

describe("request information (DC-1, PRD WF-007)", () => {
  it("DC-1 the browser journey's applicant (Ignacio Velasco, Joel's profile) is referred to review", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-IGNACIO",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(c).toMatchObject({ status: "REVIEW", outcome: "REFER" });
  });

  it("DC-1 the three new routes answer 401 without a session", async () => {
    const c = await inReview();
    const before = await snapshot(c.id);
    const anon = h.anonymous();
    await anon.post(`/cases/${c.id}/info-request`).send(REQUEST).expect(401);
    await anon.post(`/cases/${c.id}/documents/BANK_STATEMENTS_3M/upload`).expect(401);
    await anon
      .post(`/cases/${c.id}/documents/BANK_STATEMENTS_3M/review`)
      .send({ decision: "VERIFIED" })
      .expect(401);
    expect(await snapshot(c.id)).toEqual(before);
  });

  it("DC-1 the loan officer asks the borrower for documents: REVIEW → INFO_REQUESTED, a checklist line each, one event", async () => {
    const c = await inReview();
    expect(c.status).toBe("REVIEW");
    expect(c.documents).toEqual([]);
    expect(c.allowedActions).toContainEqual({
      action: "REQUEST_INFO",
      enabled: true,
      documentTypes: ["BANK_STATEMENTS_3M", "CERTIFICATE_OF_EMPLOYMENT", "INCOME_TAX_RETURN"],
    });

    const res = await h.as("paolo").post(`/cases/${c.id}/info-request`, REQUEST).expect(200);
    const after = res.body as CaseDetail;
    expect(after.status).toBe("INFO_REQUESTED");
    expect(after.infoRequest).toMatchObject({
      documents: REQUEST.documents,
      message: REQUEST.message,
      dueOn: dueIn(3),
      requestedBy: "STF-PAOLO",
      requestedByName: "Paolo Tan",
    });
    expect(after.documents.map((d) => [d.type, d.status, d.upload, d.actions])).toEqual([
      ["BANK_STATEMENTS_3M", "REQUESTED", null, ["SIMULATE_UPLOAD"]],
      ["CERTIFICATE_OF_EMPLOYMENT", "REQUESTED", null, ["SIMULATE_UPLOAD"]],
    ]);
    // While the borrower is asked, the officer can only wait or withdraw (and route the case).
    expect(after.allowedActions.map((a) => a.action)).toEqual([
      "PICK",
      "REASSIGN",
      "SET_PRIORITY",
      "WITHDRAW",
      "REPRODUCE_DECISION",
    ]);

    const events = (await activity(c.id)).filter((e) => e.action === "INFO_REQUESTED");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorName: "Paolo Tan",
      fromStatus: "REVIEW",
      toStatus: "INFO_REQUESTED",
      summary: `Requested from the borrower: Bank statements, last 3 months; Certificate of employment (due ${dueIn(3)}).`,
    });
  });

  it.each([
    ["no documents", { ...REQUEST, documents: [] }],
    ["an unknown document", { ...REQUEST, documents: ["PASSPORT"] }],
    ["no message", { ...REQUEST, message: "   " }],
    ["a due date that is not 3 or 5 days", { ...REQUEST, dueInDays: 4 }],
    ["an unknown field", { ...REQUEST, urgent: true }],
  ])("DC-1 refuses %s (400) and writes nothing", async (_label, body) => {
    const c = await inReview();
    const before = await snapshot(c.id);
    const res = await h.as("paolo").post(`/cases/${c.id}/info-request`, body).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(await snapshot(c.id)).toEqual(before);
  });

  it("DC-1 is refused outside REVIEW (409): an auto-approved offer, and a second request while one is open", async () => {
    const offer = await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00" });
    expect(offer.status).toBe("OFFER");
    expect(offer.allowedActions.map((a) => a.action)).not.toContain("REQUEST_INFO");
    const before = await snapshot(offer.id);
    await h.as("paolo").post(`/cases/${offer.id}/info-request`, REQUEST).expect(409);
    expect(await snapshot(offer.id)).toEqual(before);

    const asked = await infoRequested();
    const again = await snapshot(asked.id);
    const res = await h.as("paolo").post(`/cases/${asked.id}/info-request`, REQUEST).expect(409);
    expect(res.body.code).toBe("INVALID_STATE_TRANSITION");
    expect(await snapshot(asked.id)).toEqual(again);
  });

  it("DC-1 only the loan officer may request, upload or review (403 for the other roles)", async () => {
    const c = await infoRequested();
    const before = await snapshot(c.id);
    for (const persona of ["rina", "marco", "ella", "diane", "leo"] as const) {
      await h.as(persona).post(`/cases/${c.id}/info-request`, REQUEST).expect(403);
      await h.as(persona).post(`/cases/${c.id}/documents/BANK_STATEMENTS_3M/upload`).expect(403);
      await h
        .as(persona)
        .post(`/cases/${c.id}/documents/BANK_STATEMENTS_3M/review`, { decision: "VERIFIED" })
        .expect(403);
    }
    expect(await snapshot(c.id)).toEqual(before);
    // Compliance still reads the checklist; it is just not offered anything to do.
    const read = (await h.as("diane").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(read.documents).toHaveLength(2);
    expect(read.documents.every((d) => d.actions.length === 0)).toBe(true);
  });

  it("DC-1 a case waiting for information cannot be recommended, and can be withdrawn", async () => {
    const c = await infoRequested();
    const before = await snapshot(c.id);
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, { type: "APPROVE", rationale: "Looks fine." })
      .expect(409);
    expect(await snapshot(c.id)).toEqual(before);
    const res = await h
      .as("paolo")
      .post(`/cases/${c.id}/withdraw`, { reasonCode: "APPLICANT_REQUEST" })
      .expect(200);
    expect(res.body).toMatchObject({ status: "WITHDRAWN", closedFrom: "INFO_REQUESTED" });
  });
});

describe("simulated upload (DC-2, PRD DOC-001 simulated)", () => {
  it("DC-2 each upload records synthetic metadata labelled simulated; the last one sends the case back to review", async () => {
    const c = await infoRequested();
    const first = (await upload(c.id, "BANK_STATEMENTS_3M").expect(200)).body as CaseDetail;
    expect(first.status).toBe("INFO_REQUESTED");
    const statements = first.documents.find((d) => d.type === "BANK_STATEMENTS_3M");
    expect(statements).toMatchObject({
      status: "RECEIVED",
      upload: {
        fileName: "bank-statements-3-months.pdf",
        contentType: "application/pdf",
        sizeBytes: 184320,
        pages: 6,
        virusScan: "CLEAN",
        providerMode: "SIMULATED",
      },
      review: null,
      actions: ["VERIFY", "REJECT"],
    });
    expect(statements?.upload?.reference).toMatch(/^DOC-\d{8}$/);

    const second = (await upload(c.id, "CERTIFICATE_OF_EMPLOYMENT").expect(200)).body as CaseDetail;
    expect(second.status).toBe("REVIEW");
    expect(second.documents.map((d) => d.status)).toEqual(["RECEIVED", "RECEIVED"]);

    const events = await activity(c.id);
    expect(events.filter((e) => e.action === "DOCUMENT_RECEIVED")).toHaveLength(2);
    expect(events.find((e) => e.action === "INFO_RECEIVED")).toMatchObject({
      actorRole: "SYSTEM",
      fromStatus: "INFO_REQUESTED",
      toStatus: "REVIEW",
    });
    // One simulated upload per document; lending keeps only its metadata.
    expect(await uploadsFor(c.id)).toBe(2);
  });

  it("DC-2 a document that is not waiting for an upload is refused (409), nothing written", async () => {
    const c = await infoRequested();
    await upload(c.id, "BANK_STATEMENTS_3M").expect(200);
    const before = await snapshot(c.id);
    await upload(c.id, "BANK_STATEMENTS_3M").expect(409);
    await upload(c.id, "INCOME_TAX_RETURN").expect(409);
    expect(await snapshot(c.id)).toEqual(before);
    const bad = await upload(c.id, "PASSPORT").expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });

  it.each([
    // Down or too slow: the provider stored nothing.
    ["OUTAGE", 0],
    ["TIMEOUT", 0],
    // The provider stored the file but its reply could not be read: the retry, with the same
    // key, gets that same file instead of a second one.
    ["MALFORMED", 1],
  ] as const)(
    "DC-2 with the upload service in %s the upload answers 503 and lending writes nothing; the retry once the service is back records one file",
    async (mode, storedByProvider) => {
      const c = await infoRequested();
      const before = await snapshot(c.id);
      await setMode(h, "DOCUMENT_INTAKE", mode);
      const res = await upload(c.id, "BANK_STATEMENTS_3M").expect(503);
      expect(res.body.code).toBe("PROVIDER_UNAVAILABLE");
      expect(res.body.detail).toMatch(/Nothing was recorded: try again\.$/);
      expect(await snapshot(c.id)).toEqual(before);
      expect(await uploadsFor(c.id)).toBe(storedByProvider);

      await setMode(h, "DOCUMENT_INTAKE", "OK");
      const ok = (await upload(c.id, "BANK_STATEMENTS_3M").expect(200)).body as CaseDetail;
      expect(ok.documents[0]?.status).toBe("RECEIVED");
      expect(await uploadsFor(c.id)).toBe(1);
    },
  );

  it("DC-2 two uploads of the same document at once record it once", async () => {
    const c = await infoRequested();
    const results = await Promise.all([
      upload(c.id, "BANK_STATEMENTS_3M"),
      upload(c.id, "BANK_STATEMENTS_3M"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = (await activity(c.id)).filter((e) => e.action === "DOCUMENT_RECEIVED");
    expect(events).toHaveLength(1);
    // Both calls used the same key, so the provider kept one file.
    expect(await uploadsFor(c.id)).toBe(1);
  });
});

describe("verify or reject (DC-3, PRD DOC-003)", () => {
  async function bothReceived(): Promise<CaseDetail> {
    const c = await infoRequested();
    await upload(c.id, "BANK_STATEMENTS_3M").expect(200);
    return (await upload(c.id, "CERTIFICATE_OF_EMPLOYMENT").expect(200)).body as CaseDetail;
  }

  it("DC-3 a received document must be verified or rejected before recommending (409 with the same reason as the disabled action)", async () => {
    const c = await bothReceived();
    const reason =
      "Verify or reject the received documents first: Bank statements, last 3 months; Certificate of employment.";
    expect(c.allowedActions).toContainEqual({
      action: "RECOMMEND",
      enabled: false,
      blockedBy: "INVALID_STATE_TRANSITION",
      detail: reason,
    });
    expect(c.allowedActions).toContainEqual(
      expect.objectContaining({ action: "REQUEST_INFO", enabled: false, detail: reason }),
    );
    const before = await snapshot(c.id);
    const res = await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, { type: "APPROVE", rationale: "Looks fine." })
      .expect(409);
    expect(res.body.detail).toBe(reason);
    expect(await snapshot(c.id)).toEqual(before);
  });

  it("DC-3 verify one, reject the other with a reason; then the officer can recommend or ask again for the rejected one", async () => {
    const c = await bothReceived();
    const noReason = await review(c.id, "CERTIFICATE_OF_EMPLOYMENT", {
      decision: "REJECTED",
    }).expect(400);
    expect(noReason.body.errors).toEqual([
      { field: "reason", message: "Enter what is wrong with the document." },
    ]);

    await review(c.id, "BANK_STATEMENTS_3M", { decision: "VERIFIED" }).expect(200);
    const after = (
      await review(c.id, "CERTIFICATE_OF_EMPLOYMENT", {
        decision: "REJECTED",
        reason: "  Unsigned by the employer.  ",
      }).expect(200)
    ).body as CaseDetail;
    expect(
      after.documents.map((d) => [d.type, d.status, d.review?.byName, d.review?.rejectionReason]),
    ).toEqual([
      ["BANK_STATEMENTS_3M", "VERIFIED", "Paolo Tan", null],
      ["CERTIFICATE_OF_EMPLOYMENT", "REJECTED", "Paolo Tan", "Unsigned by the employer."],
    ]);
    expect(after.allowedActions).toContainEqual({ action: "RECOMMEND", enabled: true });
    // The API lists what a new request may ask for: not the verified statements.
    expect(after.allowedActions).toContainEqual({
      action: "REQUEST_INFO",
      enabled: true,
      documentTypes: ["CERTIFICATE_OF_EMPLOYMENT", "INCOME_TAX_RETURN"],
    });
    const events = (await activity(c.id)).map((e) => e.action);
    expect(events).toContain("DOCUMENT_VERIFIED");
    expect(events).toContain("DOCUMENT_REJECTED");

    // A second review of the same document is refused.
    await review(c.id, "BANK_STATEMENTS_3M", { decision: "REJECTED", reason: "x" }).expect(409);

    // The verified one cannot be asked for again; the rejected one can, as a new attempt.
    const verified = await h
      .as("paolo")
      .post(`/cases/${c.id}/info-request`, { ...REQUEST, documents: ["BANK_STATEMENTS_3M"] })
      .expect(400);
    expect(verified.body.errors[0].message).toBe(
      "Already verified: Bank statements, last 3 months.",
    );
    const again = (
      await h
        .as("paolo")
        .post(`/cases/${c.id}/info-request`, {
          ...REQUEST,
          documents: ["CERTIFICATE_OF_EMPLOYMENT"],
          dueInDays: 5,
        })
        .expect(200)
    ).body as CaseDetail;
    expect(again.status).toBe("INFO_REQUESTED");
    expect(again.infoRequest?.dueOn).toBe(dueIn(5));
    const coe = again.documents.find((d) => d.type === "CERTIFICATE_OF_EMPLOYMENT");
    expect(coe).toMatchObject({ status: "REQUESTED", upload: null, review: null });
    const [{ attempt }] = (await h.ds.query(
      "SELECT attempt FROM case_document WHERE case_id = $1 AND document_type = 'CERTIFICATE_OF_EMPLOYMENT'",
      [c.id],
    )) as [{ attempt: number }];
    expect(attempt).toBe(2);
    // The new attempt is a new upload (a new key), not the first one replayed.
    const reup = (await upload(c.id, "CERTIFICATE_OF_EMPLOYMENT").expect(200)).body as CaseDetail;
    expect(reup.status).toBe("REVIEW");
    expect(await uploadsFor(c.id)).toBe(3);
  });

  it("DC-3 a document that has not arrived cannot be reviewed (409), nothing written", async () => {
    const c = await infoRequested();
    const before = await snapshot(c.id);
    await review(c.id, "BANK_STATEMENTS_3M", { decision: "VERIFIED" }).expect(409);
    await review(c.id, "INCOME_TAX_RETURN", { decision: "VERIFIED" }).expect(409);
    expect(await snapshot(c.id)).toEqual(before);
    await review(c.id, "BANK_STATEMENTS_3M", { decision: "MAYBE" }).expect(400);
  });
});
