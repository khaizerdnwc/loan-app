import {
  CORE_BANKING,
  type CoreBanking,
  CREDIT_BUREAU,
  type CreditBureau,
  CUSTOMER_LOOKUP,
  type CustomerLookup,
  DISBURSEMENT,
  type Disbursement,
  DOCUMENT_EXTRACTION,
  DOCUMENT_INTAKE,
  type DocumentExtraction,
  type DocumentIntake,
  E_SIGNATURE,
  type ESignature,
  EXTERNAL_DECISION_ENGINE,
  type ExternalDecisionEngine,
  type ExternalDecisionRequest,
  FRAUD_CHECK,
  type FraudCheck,
  KYC_AML,
  type KycAml,
  NOTIFICATIONS,
  type Notifications,
  ProviderUnavailableError,
} from "@loan/contracts";
import { Money, type SimulationServiceView } from "@loan/core";
import { type Harness, setMode, startHarness } from "./support/harness";

/**
 * Conformance (PRD LND-IH-009): every simulated provider honours its port's contract and
 * every failure mode. A real provider would be enabled only after passing the same suite.
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
});

/** What the decision sends the external engine (Maria's figures unless changed). */
const externalRequest = (
  patch: Partial<ExternalDecisionRequest> = {},
): ExternalDecisionRequest => ({
  applicantId: "APL-MARIA",
  productCode: "PL",
  amount: "150000.00",
  tenorMonths: 24,
  monthlyIncome: "78000.00",
  monthlyObligations: "9000.00",
  bureauScore: 748,
  ...patch,
});

describe("the simulated client decision engine (PRD DEC-008, EX-3)", () => {
  it("applies its own synthetic policy, labelled simulated, with a stable reference", async () => {
    const engine = h.app.get<ExternalDecisionEngine>(EXTERNAL_DECISION_ENGINE);
    const approve = await engine.evaluate(externalRequest());
    expect(approve).toMatchObject({
      provider: "Client decision engine (simulated)",
      mode: "SIMULATED",
      decision: "APPROVE",
      reasonCodes: [],
    });
    expect((await engine.evaluate(externalRequest())).reference).toBe(approve.reference);
    for (const [patch, decision, code] of [
      [{ bureauScore: 559 }, "DECLINE", "EXT-LOW-SCORE"],
      [{ bureauScore: 560 }, "REFER", "EXT-SCORE-REVIEW"],
      [{ bureauScore: 639 }, "REFER", "EXT-SCORE-REVIEW"],
      [{ bureauScore: null }, "REFER", "EXT-NO-SCORE"],
      [{ monthlyIncome: "0.00" }, "REFER", "EXT-NO-INCOME"],
      // 45% of ₱78,000 is ₱35,100: at the cap approves, one centavo over refers.
      [{ monthlyObligations: "35100.00" }, "APPROVE", undefined],
      [{ monthlyObligations: "35100.01" }, "REFER", "EXT-HIGH-OBLIGATIONS"],
    ] as const) {
      const r = await engine.evaluate(externalRequest(patch));
      expect([r.decision, r.reasonCodes[0]]).toEqual([decision, code]);
    }
  });
});

const maria = {
  applicantId: "APL-MARIA",
  fullName: "Maria Santos",
  birthDate: "1995-05-10",
  governmentIdLast4: "4821",
};
const terms = { principal: Money.of("60000.00"), monthlyRate: "0.0120", tenorMonths: 12 };

describe("simulated providers conform to their ports", () => {
  it("the bureau returns the persona's report, labelled simulated; an unknown person is a no-hit", async () => {
    const bureau = h.app.get<CreditBureau>(CREDIT_BUREAU);
    expect(await bureau.pull(maria)).toMatchObject({
      mode: "SIMULATED",
      fileDepth: "FULL",
      bureauScore: 748,
    });
    expect(await bureau.pull({ ...maria, applicantId: "NOBODY" })).toMatchObject({
      fileDepth: "NO_HIT",
      bureauScore: null,
    });
  });

  it("KYC/AML matches a person it has no applicant id for on identity; a stranger is verified and clear", async () => {
    const kyc = h.app.get<KycAml>(KYC_AML);
    expect(
      await kyc.screen({ ...maria, applicantId: "NOBODY", fullName: "Someone New" }),
    ).toMatchObject({
      mode: "SIMULATED",
      kycVerified: true,
      sanctionsMatch: false,
    });
    expect(
      await kyc.screen({
        applicantId: "APL-WUNKNOWN01",
        fullName: "Ramon  cruz",
        birthDate: "1974-06-20",
        governmentIdLast4: "1188",
      }),
    ).toMatchObject({ sanctionsMatch: true, matchedList: "Simulated watchlist" });
  });

  it("KYC/AML reports a watchlist match for Ramon and clears Maria", async () => {
    const kyc = h.app.get<KycAml>(KYC_AML);
    expect(await kyc.screen(maria)).toMatchObject({
      mode: "SIMULATED",
      sanctionsMatch: false,
      kycVerified: true,
    });
    expect(await kyc.screen({ ...maria, applicantId: "APL-RAMON" })).toMatchObject({
      sanctionsMatch: true,
      matchedList: "Simulated watchlist",
    });
  });

  it("KYC/AML screened again before disbursement matches a person the list added later (Dario)", async () => {
    const kyc = h.app.get<KycAml>(KYC_AML);
    const dario = { ...maria, applicantId: "APL-DARIO" };
    expect(await kyc.screen(dario)).toMatchObject({ sanctionsMatch: false, matchedList: null });
    expect(await kyc.screen(dario, "ONBOARDING")).toMatchObject({ sanctionsMatch: false });
    expect(await kyc.screen(dario, "PRE_DISBURSEMENT")).toMatchObject({
      mode: "SIMULATED",
      sanctionsMatch: true,
      matchedList: "Simulated watchlist (updated list)",
    });
    expect(await kyc.screen(maria, "PRE_DISBURSEMENT")).toMatchObject({ sanctionsMatch: false });
  });

  it("the fraud check flags Paula, clears Maria and an unknown person, labelled simulated", async () => {
    const fraud = h.app.get<FraudCheck>(FRAUD_CHECK);
    expect(fraud.mode).toBe("SIMULATED");
    expect(await fraud.assess(maria)).toMatchObject({
      mode: "SIMULATED",
      provider: "Fraud signals (simulated)",
      flagged: false,
      signals: [],
    });
    expect(await fraud.assess({ ...maria, applicantId: "APL-PAULA" })).toMatchObject({
      flagged: true,
      signals: ["DUPLICATE_IDENTITY"],
    });
    expect(await fraud.assess({ ...maria, applicantId: "NOBODY" })).toMatchObject({
      flagged: false,
    });
  });

  it("core banking is idempotent on the key and its schedule reconciles", async () => {
    const core = h.app.get<CoreBanking>(CORE_BANKING);
    const req = {
      idempotencyKey: "conf-core-1",
      applicationId: "conf-app-1",
      customerRef: "APL-MARIA",
      terms,
      bookingDate: "2026-11-28",
    };
    const first = await core.bookLoan(req);
    const replay = await core.bookLoan(req);
    expect(replay.accountNumber).toBe(first.accountNumber);
    expect(Money.sum(first.schedule.map((l) => l.amount)).equals(first.totalRepayable)).toBe(true);
    expect(first.schedule[0]?.dueDate).toBe("2026-12-28");
  });

  it("core banking quotes the terms (ADR 0019), labelled simulated, and opens nothing", async () => {
    const core = h.app.get<CoreBanking>(CORE_BANKING);
    const before = await h.ds.query("SELECT count(*)::int AS n FROM sim.core_account");
    const q = await core.quote({ ...terms, monthlyRate: "0.0160", tenorMonths: 36 });
    expect(q.mode).toBe("SIMULATED");
    // 60,000 × 1.60% × 36 = 34,560 interest; 94,560 ÷ 36 = 2,626.66…, the last absorbs the rest.
    expect(q.totalRepayable.toString()).toBe("94560.00");
    expect(q.regularInstalment.toString()).toBe("2626.66");
    expect(q.finalInstalment.toString()).toBe("2626.90");
    expect(await h.ds.query("SELECT count(*)::int AS n FROM sim.core_account")).toEqual(before);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED", "LOST_REPLY"])(
    "core banking's quote in %s fails with ProviderUnavailableError, never a wrong answer",
    async (mode) => {
      await setMode(h, "CORE_BANKING", mode);
      const err = await h.app
        .get<CoreBanking>(CORE_BANKING)
        .quote(terms)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).service).toBe("CORE_BANKING");
    },
  );

  it("the core customer lookup finds a synthetic customer, labelled simulated; an unknown number is null", async () => {
    const core = h.app.get<CustomerLookup>(CUSTOMER_LOOKUP);
    const found = await core.find("CIF-100412");
    expect(found).toMatchObject({
      mode: "SIMULATED",
      customerNumber: "CIF-100412",
      fullName: "Celeste Navarro",
      depositAccount: "WB-SAV-0412-6045",
    });
    expect(found?.monthlyIncome.toString()).toBe("38000.00");
    expect(await core.find("CIF-000000")).toBeNull();
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "the core customer lookup in %s fails with ProviderUnavailableError, never a wrong answer",
    async (mode) => {
      await setMode(h, "CUSTOMER_LOOKUP", mode);
      const err = await h.app
        .get<CustomerLookup>(CUSTOMER_LOOKUP)
        .find("CIF-100412")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).service).toBe("CUSTOMER_LOOKUP");
    },
  );

  it("document intake returns synthetic metadata, labelled simulated, idempotent on the key", async () => {
    const intake = h.app.get<DocumentIntake>(DOCUMENT_INTAKE);
    const req = {
      idempotencyKey: "conf-doc-1",
      applicationId: "conf-app-1",
      documentType: "BANK_STATEMENTS_3M" as const,
    };
    const first = await intake.receive(req);
    expect(first).toMatchObject({
      provider: "Document intake (simulated)",
      mode: "SIMULATED",
      fileName: "bank-statements-3-months.pdf",
      contentType: "application/pdf",
      virusScan: "CLEAN",
    });
    expect(first.reference).toMatch(/^DOC-\d{8}$/);
    const replay = await intake.receive(req);
    expect(replay.reference).toBe(first.reference);
    expect(replay.receivedAt).toBe(first.receivedAt);
    const other = await intake.receive({ ...req, idempotencyKey: "conf-doc-2" });
    expect(other.reference).not.toBe(first.reference);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "document intake in %s fails with ProviderUnavailableError, never a wrong answer",
    async (mode) => {
      await setMode(h, "DOCUMENT_INTAKE", mode);
      const err = await h.app
        .get<DocumentIntake>(DOCUMENT_INTAKE)
        .receive({
          idempotencyKey: `f-doc-${mode}`,
          applicationId: "a",
          documentType: "INCOME_TAX_RETURN",
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).service).toBe("DOCUMENT_INTAKE");
    },
  );

  it("the email and SMS gateway accepts a message, labelled simulated, idempotent on the key, and keeps no words", async () => {
    const gateway = h.app.get<Notifications>(NOTIFICATIONS);
    const msg = {
      idempotencyKey: "conf-msg-1",
      channel: "SMS" as const,
      recipientRef: "applicant:APL-MARIA",
      template: "OFFER_READY",
      subject: "Your WhiteBank loan offer is ready",
      body: "Your application WB-1 is approved.",
    };
    const first = await gateway.send(msg);
    expect(first).toMatchObject({
      provider: "Email and SMS gateway (simulated)",
      mode: "SIMULATED",
      channel: "SMS",
      idempotencyKey: "conf-msg-1",
    });
    expect(first.reference).toMatch(/^MSG-\d{8}$/);
    const replay = await gateway.send(msg);
    expect(replay.reference).toBe(first.reference);
    expect(replay.acceptedAt).toBe(first.acceptedAt);
    expect((await gateway.send({ ...msg, idempotencyKey: "conf-msg-2" })).reference).not.toBe(
      first.reference,
    );
    // The simulator's statement holds the template and a reference to the person, not the words.
    const columns = (await h.ds.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sim' AND table_name = 'notification' ORDER BY column_name`,
    )) as { column_name: string }[];
    expect(columns.map((c) => c.column_name)).toEqual([
      "accepted_at",
      "channel",
      "idempotency_key",
      "recipient_ref",
      "reference",
      "template",
    ]);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "the email and SMS gateway in %s fails with ProviderUnavailableError, never a wrong answer",
    async (mode) => {
      await setMode(h, "NOTIFICATIONS", mode);
      const err = await h.app
        .get<Notifications>(NOTIFICATIONS)
        .send({
          idempotencyKey: `f-msg-${mode}`,
          channel: "EMAIL",
          recipientRef: "applicant:APL-MARIA",
          template: "DECLINED",
          subject: "s",
          body: "b",
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).service).toBe("NOTIFICATIONS");
    },
  );

  it("OCR reads each synthetic file into labelled rows and a document into the applicant's figures, idempotent on the key (INT-1, OCR-1)", async () => {
    const ocr = h.app.get<DocumentExtraction>(DOCUMENT_EXTRACTION);
    const sheet = await ocr.extractBundle({
      idempotencyKey: "conf-ocr-1",
      source: "PARTNER_SPREADSHEET",
    });
    expect(sheet).toMatchObject({
      provider: "OCR and statement analysis (simulated)",
      mode: "SIMULATED",
      fingerprint: "SYN-SHEET-CORDILLERA-2026-11",
    });
    expect(sheet.rows.map((r) => [r.rowNumber, r.fullName, r.amount?.toString()])).toEqual([
      [2, "Ramil Ocampo", "50000.00"],
      [3, "Joy Fernandez", "90000.00"],
      [4, "Elmer Santos", "70000.00"],
    ]);
    const again = await ocr.extractBundle({
      idempotencyKey: "conf-ocr-1",
      source: "PARTNER_SPREADSHEET",
    });
    expect(again.reference).toBe(sheet.reference);
    const other = await ocr.extractBundle({
      idempotencyKey: "conf-ocr-2",
      source: "PARTNER_SPREADSHEET",
    });
    expect(other.reference).not.toBe(sheet.reference);

    const req = {
      idempotencyKey: "conf-ocr-doc-1",
      applicantId: "APL-MARIA",
      documentType: "BANK_STATEMENTS_3M" as const,
      uploadReference: "DOC-00000001",
    };
    const reading = await ocr.readDocument(req);
    expect(reading).toMatchObject({ mode: "SIMULATED", employer: "Luzon Freight Services Inc." });
    expect(reading.monthlyIncome?.toString()).toBe("78000.00");
    expect(reading.statement?.recurringObligations.toString()).toBe("9000.00");
    expect((await ocr.readDocument(req)).reference).toBe(reading.reference);
    // No statement analysis for other documents; nothing read for an unknown applicant.
    expect(
      (await ocr.readDocument({ ...req, documentType: "INCOME_TAX_RETURN" })).statement,
    ).toBeNull();
    const unknown = await ocr.readDocument({ ...req, applicantId: "APL-NOBODY" });
    expect(unknown).toMatchObject({ monthlyIncome: null, employer: null, statement: null });
  });

  it("OCR reads each synthetic file of a source by its key, and refuses a key of another source (INT-9)", async () => {
    const ocr = h.app.get<DocumentExtraction>(DOCUMENT_EXTRACTION);
    const makati = await ocr.extractBundle({
      idempotencyKey: "conf-ocr-m",
      source: "PARTNER_SPREADSHEET",
      sampleFile: "MAKATI_LOGISTICS",
    });
    expect(makati.fingerprint).toBe("SYN-SHEET-MAKATI-2026-12");
    expect(makati.rows.map((r) => [r.rowNumber, r.fullName])).toEqual([
      [2, "Marites Dela Paz"],
      [3, "Rodel Pascual"],
    ]);
    const abad = await ocr.extractBundle({
      idempotencyKey: "conf-ocr-a",
      source: "EMAIL_BUNDLE",
      sampleFile: "ABAD",
    });
    expect(abad.rows[0]?.documentMonthlyIncome?.toString()).toBe("41000.00");
    const statements = await ocr.readDocument({
      idempotencyKey: "conf-ocr-a-doc",
      applicantId: "APL-LORNA-ABAD",
      documentType: "BANK_STATEMENTS_3M",
      uploadReference: "DOC-1",
    });
    expect(statements.statement?.salaryCredit.toString()).toBe("41000.00");
    const wrong = await ocr
      .extractBundle({
        idempotencyKey: "conf-ocr-w",
        source: "EMAIL_BUNDLE",
        sampleFile: "MAKATI_LOGISTICS",
      })
      .catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ProviderUnavailableError);
  });

  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "OCR in %s fails with ProviderUnavailableError for files and documents, never a wrong answer",
    async (mode) => {
      await setMode(h, "DOCUMENT_EXTRACTION", mode);
      const ocr = h.app.get<DocumentExtraction>(DOCUMENT_EXTRACTION);
      for (const call of [
        () => ocr.extractBundle({ idempotencyKey: `f-ocr-${mode}`, source: "EMAIL_BUNDLE" }),
        () =>
          ocr.readDocument({
            idempotencyKey: `f-ocr-doc-${mode}`,
            applicantId: "APL-MARIA",
            documentType: "CERTIFICATE_OF_EMPLOYMENT",
            uploadReference: "DOC-1",
          }),
      ]) {
        const err = await call().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        expect((err as ProviderUnavailableError).service).toBe("DOCUMENT_EXTRACTION");
      }
    },
  );

  it("disbursement and e-signature are idempotent on the key", async () => {
    const pay = h.app.get<Disbursement>(DISBURSEMENT);
    const req = {
      idempotencyKey: "conf-pay-1",
      loanAccountNumber: "LN-X",
      amount: Money.of("60000.00"),
      destinationAccount: "WB-1",
    };
    expect((await pay.disburse(req)).reference).toBe((await pay.disburse(req)).reference);
    const sign = h.app.get<ESignature>(E_SIGNATURE);
    const sreq = {
      idempotencyKey: "conf-sig-1",
      applicationId: "a",
      signerName: "Maria Santos",
      documentTitle: "Agreement",
    };
    expect((await sign.sign(sreq)).envelopeId).toBe((await sign.sign(sreq)).envelopeId);
  });

  it.each([
    ["CREDIT_BUREAU", "OUTAGE"],
    ["CREDIT_BUREAU", "TIMEOUT"],
    ["CREDIT_BUREAU", "MALFORMED"],
    ["KYC_AML", "OUTAGE"],
    ["KYC_AML", "MALFORMED"],
    ["CORE_BANKING", "OUTAGE"],
    ["CORE_BANKING", "TIMEOUT"],
    ["CORE_BANKING", "MALFORMED"],
    ["CORE_BANKING", "LOST_REPLY"],
    ["DISBURSEMENT", "OUTAGE"],
    ["DISBURSEMENT", "MALFORMED"],
    ["E_SIGNATURE", "TIMEOUT"],
    ["E_SIGNATURE", "MALFORMED"],
    ["FRAUD", "OUTAGE"],
    ["FRAUD", "TIMEOUT"],
    ["FRAUD", "MALFORMED"],
    ["EXTERNAL_DECISION", "OUTAGE"],
    ["EXTERNAL_DECISION", "TIMEOUT"],
    ["EXTERNAL_DECISION", "MALFORMED"],
  ])(
    "%s in %s fails with ProviderUnavailableError, never a wrong answer",
    async (service, mode) => {
      await setMode(h, service, mode);
      const call = {
        CREDIT_BUREAU: () => h.app.get<CreditBureau>(CREDIT_BUREAU).pull(maria),
        KYC_AML: () => h.app.get<KycAml>(KYC_AML).screen(maria),
        CORE_BANKING: () =>
          h.app.get<CoreBanking>(CORE_BANKING).bookLoan({
            idempotencyKey: `f-${mode}`,
            applicationId: "f",
            customerRef: "x",
            terms,
            bookingDate: "2026-11-28",
          }),
        DISBURSEMENT: () =>
          h.app.get<Disbursement>(DISBURSEMENT).disburse({
            idempotencyKey: `f-${mode}`,
            loanAccountNumber: "LN",
            amount: Money.of("1.00"),
            destinationAccount: "WB",
          }),
        E_SIGNATURE: () =>
          h.app.get<ESignature>(E_SIGNATURE).sign({
            idempotencyKey: `f-${mode}`,
            applicationId: "a",
            signerName: "n",
            documentTitle: "d",
          }),
        FRAUD: () => h.app.get<FraudCheck>(FRAUD_CHECK).assess(maria),
        EXTERNAL_DECISION: () =>
          h.app.get<ExternalDecisionEngine>(EXTERNAL_DECISION_ENGINE).evaluate(externalRequest()),
      }[service as "CREDIT_BUREAU"];
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).service).toBe(service);
    },
  );

  it("the account and payment feeds list what core and the rail hold, labelled simulated (REC)", async () => {
    const core = h.app.get<CoreBanking>(CORE_BANKING);
    const pay = h.app.get<Disbursement>(DISBURSEMENT);
    const account = await core.bookLoan({
      idempotencyKey: "feed-1",
      applicationId: "feed-app",
      customerRef: "APL-MARIA",
      terms,
      bookingDate: "2026-11-28",
    });
    await pay.disburse({
      idempotencyKey: "feed-1",
      loanAccountNumber: account.accountNumber,
      amount: account.principal,
      destinationAccount: "WB-SAV-1",
    });
    expect((await core.listAccounts()).find((a) => a.idempotencyKey === "feed-1")).toMatchObject({
      mode: "SIMULATED",
      accountNumber: account.accountNumber,
      applicationId: "feed-app",
    });
    const payment = (await pay.listPayments()).find((p) => p.idempotencyKey === "feed-1");
    expect(payment).toMatchObject({ mode: "SIMULATED", loanAccountNumber: account.accountNumber });
    expect(payment?.amount.equals(account.principal)).toBe(true);
  });

  it.each([
    ["CORE_BANKING", "OUTAGE"],
    ["CORE_BANKING", "TIMEOUT"],
    ["CORE_BANKING", "MALFORMED"],
    ["CORE_BANKING", "LOST_REPLY"],
    ["DISBURSEMENT", "OUTAGE"],
    ["DISBURSEMENT", "TIMEOUT"],
    ["DISBURSEMENT", "MALFORMED"],
  ])("the %s feed in %s fails with ProviderUnavailableError", async (service, mode) => {
    await setMode(h, service, mode);
    if (mode === "MALFORMED") {
      // A malformed feed needs at least one record to garble.
      await h.ds.query(
        `INSERT INTO sim.core_account (idempotency_key, account_number, application_id, payload)
         VALUES ('feed-m', 'LN-FEED-M', 'x', '{"accountNumber":"LN-FEED-M","principal":"1.00","openedAt":"2026-11-28T00:00:00.000Z"}')
         ON CONFLICT DO NOTHING`,
      );
      await h.ds.query(
        `INSERT INTO sim.disbursement (idempotency_key, reference, payload)
         VALUES ('feed-m', 'DSB-FEED-M', '{"reference":"DSB-FEED-M","amount":"1.00","loanAccountNumber":"LN-FEED-M","disbursedAt":"2026-11-28T00:00:00.000Z"}')
         ON CONFLICT DO NOTHING`,
      );
    }
    const call =
      service === "CORE_BANKING"
        ? () => h.app.get<CoreBanking>(CORE_BANKING).listAccounts()
        : () => h.app.get<Disbursement>(DISBURSEMENT).listPayments();
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).service).toBe(service);
  });
});

describe("simulation controls", () => {
  it("lists every service with its supported modes; only core banking can lose a reply", async () => {
    const list = (await h.as("paolo").get("/simulation/services").expect(200))
      .body as SimulationServiceView[];
    expect(list.map((s) => s.service).sort()).toEqual([
      "CORE_BANKING",
      "CREDIT_BUREAU",
      "CUSTOMER_LOOKUP",
      "DISBURSEMENT",
      "DOCUMENT_EXTRACTION",
      "DOCUMENT_INTAKE",
      "EXTERNAL_DECISION",
      "E_SIGNATURE",
      "FRAUD",
      "KYC_AML",
      "NOTIFICATIONS",
    ]);
    for (const s of list) {
      expect(s.mode).toBe("OK");
      expect(s.supportedModes.includes("LOST_REPLY" as never)).toBe(s.service === "CORE_BANKING");
    }
  });

  it("refuses LOST_REPLY for a service other than core banking", async () => {
    const res = await h
      .as("leo")
      .put("/simulation/services/CREDIT_BUREAU", { mode: "LOST_REPLY" })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("refuses an unknown service", async () => {
    const res = await h
      .as("leo")
      .put("/simulation/services/WEATHER", { mode: "OUTAGE" })
      .expect(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("a failure mode switches itself back to OK after its reset time", async () => {
    const set = await h
      .as("leo")
      .put("/simulation/services/CREDIT_BUREAU", { mode: "OUTAGE" })
      .expect(200);
    expect(set.body).toMatchObject({ mode: "OUTAGE", setBy: "Leo Santiago" });
    expect(Date.parse(set.body.resetsAt) - Date.now()).toBeGreaterThan(14 * 60_000);
    await h.ds.query("UPDATE sim.service_mode SET resets_at = now() - interval '1 second'");
    const after = (await h.as("leo").get("/simulation/services").expect(200))
      .body as SimulationServiceView[];
    expect(after.find((s) => s.service === "CREDIT_BUREAU")).toMatchObject({
      mode: "OK",
      resetsAt: null,
    });
  });
});
