import {
  CORE_BANKING,
  type CoreBanking,
  CREDIT_BUREAU,
  type CreditBureau,
  DISBURSEMENT,
  type Disbursement,
  DOCUMENT_INTAKE,
  type DocumentIntake,
  E_SIGNATURE,
  type ESignature,
  FRAUD_CHECK,
  type FraudCheck,
  KYC_AML,
  type KycAml,
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
      }[service as "CREDIT_BUREAU"];
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).service).toBe(service);
    },
  );
});

describe("simulation controls", () => {
  it("lists every service with its supported modes; only core banking can lose a reply", async () => {
    const list = (await h.as("paolo").get("/simulation/services").expect(200))
      .body as SimulationServiceView[];
    expect(list.map((s) => s.service).sort()).toEqual([
      "CORE_BANKING",
      "CREDIT_BUREAU",
      "DISBURSEMENT",
      "DOCUMENT_INTAKE",
      "E_SIGNATURE",
      "FRAUD",
      "KYC_AML",
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
