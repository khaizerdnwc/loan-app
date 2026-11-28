import { AuditService, NotificationReadsService, NotificationService } from "@loan/base";
import { NOTIFICATIONS, type Notifications } from "@loan/contracts";
import type {
  BorrowerMessageView,
  CaseDetail,
  StaffNotificationList,
  StaffNotificationView,
} from "@loan/core";
import { Logger } from "@nestjs/common";
import {
  count,
  FULL_CONSENT,
  type Harness,
  type Persona,
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
afterEach(async () => {
  await h.ds.query("TRUNCATE sim.service_mode");
});

const dispatch = () => h.app.get(NotificationService).dispatchPending();
const referred = () =>
  submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });

const alerts = async (persona: Persona) =>
  (await h.as(persona).get("/notifications").expect(200)).body as StaffNotificationList;
const messages = async (caseId: string, persona: Persona = "paolo") =>
  (await h.as(persona).get(`/notifications/cases/${caseId}`).expect(200))
    .body as BorrowerMessageView[];
const forCase = (list: StaffNotificationList, c: CaseDetail) =>
  list.items.filter((n) => n.caseId === c.id);

/** Move a case's whole history back in time, as the table's owner would have to. */
async function backdate(caseId: string, days: number): Promise<void> {
  await h.ds.query("ALTER TABLE activity_event DISABLE TRIGGER activity_event_insert_only");
  try {
    await h.ds.query(
      `UPDATE activity_event SET created_at = created_at - ($2 || ' days')::interval
        WHERE case_id = $1`,
      [caseId, String(days)],
    );
  } finally {
    await h.ds.query("ALTER TABLE activity_event ENABLE TRIGGER activity_event_insert_only");
  }
}

describe("borrower messages through the simulated email and SMS gateway (PRD NTF-001, NTF-003)", () => {
  it("NTF-1 a referral writes one borrower email in the decision's transaction; the sweep sends it, labelled simulated", async () => {
    const c = await referred();
    expect(c.status).toBe("REVIEW");
    const [waiting] = await messages(c.id);
    expect(waiting).toMatchObject({
      channel: "EMAIL",
      template: "UNDER_REVIEW",
      recipient: "Applicant, email on file",
      status: "PENDING",
      attempts: 0,
      providerReference: null,
    });
    expect(waiting?.body).toContain(c.reference);

    expect((await dispatch()).sent).toBeGreaterThanOrEqual(1);
    const [sent] = await messages(c.id);
    expect(sent).toMatchObject({ status: "SENT", attempts: 1, providerMode: "SIMULATED" });
    expect(sent?.providerReference).toMatch(/^MSG-\d{8}$/);
    // The gateway was given a reference to the applicant, never an address or a name.
    const [row] = (await h.ds.query(
      "SELECT recipient_ref, template FROM sim.notification WHERE reference = $1",
      [sent?.providerReference],
    )) as { recipient_ref: string; template: string }[];
    expect(row).toEqual({ recipient_ref: `applicant:${c.applicant.id}`, template: "UNDER_REVIEW" });
    // Sent once: the next sweep has nothing for it.
    await dispatch();
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM sim.notification WHERE recipient_ref = $1", [
        `applicant:${c.applicant.id}`,
      ]),
    ).toBe(1);
  });

  it("NTF-3 a gateway outage leaves the message waiting with the attempt counted and never touches the case; five failed attempts give up", async () => {
    await dispatch();
    const c = await referred();
    await setMode(h, "NOTIFICATIONS", "OUTAGE");
    expect(await dispatch()).toMatchObject({ sent: 0, waiting: 1, failed: 0 });
    const [first] = await messages(c.id);
    expect(first).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastError: "The email/SMS gateway (simulated) was unavailable.",
    });
    for (let i = 0; i < 4; i += 1) await dispatch();
    const [given] = await messages(c.id);
    expect(given).toMatchObject({ status: "FAILED", attempts: 5 });
    // A FAILED message is not tried again, and the case carried on regardless.
    await h.ds.query("TRUNCATE sim.service_mode");
    expect((await dispatch()).sent).toBe(0);
    expect(
      ((await h.as("paolo").get(`/cases/${c.id}`).expect(200)).body as CaseDetail).status,
    ).toBe("REVIEW");
  });

  it("NTF-3 a malformed reply is retried with the same key: one message at the gateway, one reference", async () => {
    await dispatch();
    const c = await referred();
    await setMode(h, "NOTIFICATIONS", "MALFORMED");
    expect((await dispatch()).waiting).toBe(1);
    expect((await messages(c.id))[0]?.lastError).toBe(
      "The email/SMS gateway (simulated) sent a reply that could not be read.",
    );
    const key = (
      (await h.ds.query("SELECT idempotency_key FROM notification_delivery WHERE case_id = $1", [
        c.id,
      ])) as { idempotency_key: string }[]
    )[0]?.idempotency_key;
    // The gateway took it the first time; only the reply was unreadable.
    const [atGateway] = (await h.ds.query(
      "SELECT reference FROM sim.notification WHERE idempotency_key = $1",
      [key],
    )) as { reference: string }[];
    await h.ds.query("TRUNCATE sim.service_mode");
    await dispatch();
    const [sent] = await messages(c.id);
    expect(sent).toMatchObject({ status: "SENT", attempts: 2, lastError: null });
    expect(sent?.providerReference).toBe(atGateway?.reference);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM sim.notification WHERE idempotency_key = $1", [
        key,
      ]),
    ).toBe(1);
  });

  it("NTF-1 the message log follows the case's own visibility and its readers' roles", async () => {
    const c = await referred();
    expect(await messages(c.id, "diane")).toHaveLength(1);
    // Loan operations cannot see a case in review: 404, as for the case itself.
    await h.as("marco").get(`/notifications/cases/${c.id}`).expect(404);
    await h.as("leo").get(`/notifications/cases/${c.id}`).expect(403);
    await h.as("paolo").get("/notifications/cases/not-a-uuid").expect(400);
    await h.anonymous().get(`/notifications/cases/${c.id}`).expect(401);
  });
});

describe("staff alerts (PRD NTF-002, WF-003)", () => {
  it("NTF-2 a recommendation alerts every approver; one approver marks it read for the role; others cannot touch it", async () => {
    const c = await referred();
    await h.as("paolo").post(`/cases/${c.id}/pick`).expect(200);
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, {
        type: "APPROVE",
        rationale: "Reviewed: approve as requested.",
      })
      .expect(200);
    const [alert] = forCase(await alerts("rina"), c);
    expect(alert).toMatchObject({
      kind: "APPROVAL_WAITING",
      title: `${c.reference} is waiting for your approval`,
      caseReference: c.reference,
      forRole: "APPROVER",
      readAt: null,
    });
    expect(forCase(await alerts("ben"), c).map((n) => n.id)).toEqual([alert?.id]);
    // Not the officer who recommended it, nor any other role.
    expect(forCase(await alerts("paolo"), c)).toEqual([]);
    expect(forCase(await alerts("marco"), c)).toEqual([]);
    await h.as("paolo").post(`/notifications/${alert?.id}/read`).expect(404);

    const unread = (await alerts("ben")).unread;
    const read = (await h.as("rina").post(`/notifications/${alert?.id}/read`).expect(200))
      .body as StaffNotificationView;
    expect(read.readAt).not.toBeNull();
    expect(forCase(await alerts("ben"), c)[0]?.readAt).toBe(read.readAt);
    expect((await alerts("ben")).unread).toBe(unread - 1);
    // Marking it read again changes nothing.
    const again = (await h.as("ben").post(`/notifications/${alert?.id}/read`).expect(200))
      .body as StaffNotificationView;
    expect(again.readAt).toBe(read.readAt);
  });

  it("NTF-2 a reassignment alerts the new owner by name only; a refused change writes no alert", async () => {
    const c = await referred();
    await h.as("paolo").post(`/cases/${c.id}/pick`).expect(200);
    const before = await count(h.ds, "SELECT count(*) AS n FROM staff_notification");
    const messagesBefore = await count(h.ds, "SELECT count(*) AS n FROM notification_delivery");
    // Refused (409): the change, its alerts and its messages roll back together.
    await h
      .as("paolo")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-PAOLO", reason: "Mine already." })
      .expect(409);
    expect(await count(h.ds, "SELECT count(*) AS n FROM staff_notification")).toBe(before);
    expect(await count(h.ds, "SELECT count(*) AS n FROM notification_delivery")).toBe(
      messagesBefore,
    );

    await h
      .as("paolo")
      .post(`/cases/${c.id}/reassign`, { ownerId: "STF-JOY", reason: "On leave from Monday." })
      .expect(200);
    expect(forCase(await alerts("joy"), c)).toEqual([
      expect.objectContaining({
        kind: "ASSIGNED",
        title: `${c.reference} was reassigned to you`,
        forRole: null,
      }),
    ]);
    expect(forCase(await alerts("paolo"), c)).toEqual([]);
    // A personal alert is joy's alone: another loan officer cannot mark it read, or learn it exists.
    const [joys] = forCase(await alerts("joy"), c);
    await h.as("paolo").post(`/notifications/${joys?.id}/read`).expect(404);
    expect(forCase(await alerts("joy"), c)[0]?.readAt).toBeNull();
  });

  it("NTF-2 a case past its SLA alerts its owner once per stage visit", async () => {
    const c = await referred();
    await h.as("paolo").post(`/cases/${c.id}/pick`).expect(200);
    await backdate(c.id, 10);
    const reads = h.app.get(NotificationReadsService);
    expect(await reads.alertBreaches()).toBeGreaterThanOrEqual(1);
    await reads.alertBreaches();
    const breach = forCase(await alerts("paolo"), c).filter((n) => n.kind === "SLA_BREACHED");
    expect(breach).toEqual([
      expect.objectContaining({
        title: `${c.reference} is past its SLA (In review)`,
        forRole: null,
      }),
    ]);
    // Addressed to the owner, so another officer does not see it.
    expect(forCase(await alerts("joy"), c)).toEqual([]);
  });

  it("NTF-2 every role reads its own alerts; anonymous is refused and a bad id is 400", async () => {
    // The administrator has no case work: an empty list, not a refusal.
    expect(await alerts("leo")).toEqual({ items: [], unread: 0 });
    expect(typeof (await alerts("diane")).unread).toBe("number");
    await h.anonymous().get("/notifications").expect(401);
    await h.as("rina").post("/notifications/not-a-uuid/read").expect(400);
    await h.as("rina").post("/notifications/00000000-0000-4000-8000-000000000000/read").expect(404);
  });
});

describe("no tipping-off, rollback and breadth (PRD NTF-001, CMP-005)", () => {
  it("NTF-1 a sanctions knockout sends the borrower one plain decline and nothing about the AML review; Compliance is alerted", async () => {
    const c = await submitCase(h, { applicantId: "APL-RAMON", amount: "50000.00" });
    expect(c.status).toBe("DECLINED");
    const sent = await messages(c.id, "diane");
    expect(sent.map((m) => [m.template, m.channel])).toEqual([["DECLINED", "EMAIL"]]);
    expect(sent[0]?.body).toContain(c.reference);
    expect(`${sent[0]?.subject} ${sent[0]?.body}`).not.toMatch(
      /sanction|AML|watchlist|screening|money laundering|compliance/i,
    );
    expect(forCase(await alerts("diane"), c)).toEqual([
      expect.objectContaining({
        kind: "AML_REVIEW",
        title: `${c.reference}: an AML review is waiting for you`,
        forRole: "COMPLIANCE",
      }),
    ]);
  });

  it("NTF-1 a pre-disbursement AML hold writes no borrower message for the held booking", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-DARIO",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(c.status).toBe("OFFER");
    await readyForChecker(h, c.id);
    const before = await count(
      h.ds,
      "SELECT count(*) AS n FROM notification_delivery WHERE case_id = $1",
      [c.id],
    );
    const res = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(res.body.code).toBe("SCREENING_MATCH");
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM notification_delivery WHERE case_id = $1", [
        c.id,
      ]),
    ).toBe(before);
    // Only the offer was ever messaged (email and SMS); nothing after it.
    expect((await messages(c.id, "diane")).map((m) => m.template).sort()).toEqual([
      "OFFER_READY",
      "OFFER_READY",
    ]);
  });

  it("NTF-1 a failed audit write rolls back the decline's borrower message with the rest of the submission", async () => {
    const applicantId = await twin(h, "APL-RAMON");
    const draft = await h
      .as("paolo")
      .post("/cases", {
        applicantId,
        amount: "50000.00",
        tenorMonths: 12,
        purpose: "Home improvement",
        submit: false,
        consent: FULL_CONSENT,
      })
      .expect(201);
    const id = draft.body.id as string;
    // The decline's message is written before the AML escalation's audit entry fails.
    const audit = h.app.get(AuditService);
    const real = audit.append.bind(audit);
    const spy = jest
      .spyOn(audit, "append")
      .mockImplementation((m, input) =>
        input.action === "AML_ESCALATION_OPENED"
          ? Promise.reject(new Error("simulated audit store failure"))
          : real(m, input),
      );
    try {
      await h.as("paolo").post(`/cases/${id}/submit`).expect(500);
    } finally {
      spy.mockRestore();
    }
    const where = "WHERE case_id = $1";
    expect(
      await count(h.ds, `SELECT count(*) AS n FROM notification_delivery ${where}`, [id]),
    ).toBe(0);
    expect(await count(h.ds, `SELECT count(*) AS n FROM staff_notification ${where}`, [id])).toBe(
      0,
    );
    await h.as("paolo").post(`/cases/${id}/submit`).expect(200);
    expect(
      await count(h.ds, `SELECT count(*) AS n FROM notification_delivery ${where}`, [id]),
    ).toBe(1);
  });

  it("NTF-1 a disbursed loan messages the borrower by email and SMS", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(c.status).toBe("OFFER");
    await readyForChecker(h, c.id);
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    const disbursed = (await messages(c.id)).filter((m) => m.template === "DISBURSED");
    expect(disbursed.map((m) => m.channel).sort()).toEqual(["EMAIL", "SMS"]);
    expect(disbursed.map((m) => m.recipient).sort()).toEqual([
      "Applicant, email on file",
      "Applicant, mobile number on file",
    ]);
  });
});

describe("the sweep's resilience (NTF-3)", () => {
  it("NTF-3 an unexpected error on one message is that message's attempt, in words, and the rest still go", async () => {
    await dispatch();
    const first = await referred();
    const second = await referred();
    const gateway = h.app.get<Notifications>(NOTIFICATIONS);
    const real = gateway.send.bind(gateway);
    let thrown = false;
    const spy = jest.spyOn(gateway, "send").mockImplementation(async (msg) => {
      if (!thrown) {
        thrown = true;
        throw new TypeError("applicant Joel Reyes at 12 Mabini St");
      }
      return real(msg);
    });
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    let warned: unknown[][] = [];
    try {
      expect(await dispatch()).toEqual({ sent: 1, waiting: 1, failed: 0 });
    } finally {
      // Read before restoring (mockRestore clears the recorded calls); only this service's lines.
      warned = warn.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].startsWith("Borrower message"),
      );
      warn.mockRestore();
      spy.mockRestore();
    }
    const [a] = await messages(first.id);
    const [b] = await messages(second.id);
    const failed = [a, b].find((m) => m?.status === "PENDING");
    expect(failed).toMatchObject({
      attempts: 1,
      lastError:
        "The message could not be handed to the email/SMS gateway (simulated) because of an unexpected error.",
    });
    // Neither the error's text nor its class reaches staff; the class is logged on the server,
    // with the message's id, and the error's text is not.
    expect(JSON.stringify([a, b])).not.toMatch(/Mabini|TypeError/);
    expect(warned).toEqual([[`Borrower message ${failed?.id}: unexpected error (TypeError).`]]);
    expect([a, b].filter((m) => m?.status === "SENT")).toHaveLength(1);
  });

  it("NTF-3 two sweeps at once claim different messages: each is attempted once", async () => {
    await dispatch();
    const cases = [await referred(), await referred(), await referred()];
    await setMode(h, "NOTIFICATIONS", "OUTAGE");
    const gateway = h.app.get<Notifications>(NOTIFICATIONS);
    const real = gateway.send.bind(gateway);
    const keys: string[] = [];
    // The first sweep is held inside its first gateway call until the second sweep is done.
    let entered: () => void = () => {};
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest.spyOn(gateway, "send").mockImplementation(async (msg) => {
      keys.push(msg.idempotencyKey);
      if (keys.length === 1) {
        entered();
        await gate;
      }
      return real(msg);
    });
    try {
      const first = dispatch();
      await inside;
      // The held message is claimed, so the second sweep takes only the other two.
      expect(await dispatch()).toEqual({ sent: 0, waiting: 2, failed: 0 });
      release();
      expect(await first).toEqual({ sent: 0, waiting: 1, failed: 0 });
    } finally {
      // Never leave a sweep hanging on the gate if an assertion above failed.
      release();
      spy.mockRestore();
    }
    expect(new Set(keys).size).toBe(3);
    expect(keys).toHaveLength(3);
    for (const c of cases) {
      expect((await messages(c.id))[0]?.attempts).toBe(1);
    }
    // The lease ends when the attempt is recorded: the next sweep takes them again.
    expect((await dispatch()).waiting).toBe(3);
  });

  it("NTF-3 a sweep whose lease ran out and was taken over writes nothing", async () => {
    await dispatch();
    const c = await referred();
    const gateway = h.app.get<Notifications>(NOTIFICATIONS);
    const real = gateway.send.bind(gateway);
    let calls = 0;
    let entered: () => void = () => {};
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest.spyOn(gateway, "send").mockImplementation(async (msg) => {
      calls += 1;
      if (calls === 1) {
        entered();
        await gate;
        throw new TypeError("late");
      }
      // The second sweep's call: the gateway is in OUTAGE by now.
      return real(msg);
    });
    try {
      const slow = dispatch();
      await inside;
      // The slow sweep's lease runs out; another sweep claims the message during an outage, so
      // the row stays PENDING: only the lease token can stop the slow sweep's write now.
      await h.ds.query(
        "UPDATE notification_delivery SET claimed_until = now() - interval '1 second' WHERE case_id = $1",
        [c.id],
      );
      await setMode(h, "NOTIFICATIONS", "OUTAGE");
      expect(await dispatch()).toEqual({ sent: 0, waiting: 1, failed: 0 });
      release();
      // The slow sweep's late failure is not recorded: its lease is no longer the row's.
      expect(await slow).toEqual({ sent: 0, waiting: 0, failed: 0 });
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await messages(c.id))[0]).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastError: "The email/SMS gateway (simulated) was unavailable.",
    });
  });
});
