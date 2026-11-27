import type { CoreAccountRecord, PaymentRecord } from "@loan/contracts";
import { Money } from "@loan/core";
import { dropSettled, type LendingBooking, reconcile } from "../../src/operations/reconcile";
import { reportPeriod, share } from "../../src/reports/period";

const core = (
  key: string,
  n: string,
  principal = "60000.00",
  app = `app-${key}`,
): CoreAccountRecord => ({
  mode: "SIMULATED",
  idempotencyKey: key,
  accountNumber: n,
  applicationId: app,
  principal: Money.of(principal),
  openedAt: "2026-11-28T01:00:00.000Z",
});
const pay = (key: string, ref: string, amount = "60000.00"): PaymentRecord => ({
  mode: "SIMULATED",
  idempotencyKey: key,
  reference: ref,
  loanAccountNumber: "LN-x",
  amount: Money.of(amount),
  disbursedAt: "2026-11-28T01:00:00.000Z",
});
const lend = (key: string, patch: Partial<LendingBooking> = {}): LendingBooking => ({
  idempotencyKey: key,
  caseId: `case-${key}`,
  caseReference: `APP-${key}`,
  account: null,
  disbursement: null,
  ...patch,
});
const booked = (key: string, n: string, ref: string, amount = "60000.00") =>
  lend(key, {
    account: { number: n, principal: Money.of(amount) },
    disbursement: { reference: ref, amount: Money.of(amount) },
  });

describe("reconcile (PRD BKG-005)", () => {
  it("a booking both sides agree on is matched, with no finding", () => {
    const r = reconcile([booked("k1", "LN-1", "D-1")], [core("k1", "LN-1")], [pay("k1", "D-1")]);
    expect(r.summary).toEqual({
      bookingRequests: 1,
      matched: 1,
      coreAccounts: 1,
      payments: 1,
      findings: 0,
      duplicates: 0,
      settledDuringRun: 0,
    });
    expect(r.findings).toEqual([]);
  });

  it("a booking that never reached core is not a finding", () => {
    expect(reconcile([lend("k1")], [], []).findings).toEqual([]);
  });

  it("a core account lending never recorded, unpaid: open, undisbursed (lost reply)", () => {
    const r = reconcile([lend("k1")], [core("k1", "LN-1")], []);
    expect(r.findings).toEqual([
      expect.objectContaining({
        kind: "CORE_ACCOUNT_UNDISBURSED",
        caseReference: "APP-k1",
        coreAccountNumber: "LN-1",
        lendingAccountNumber: null,
        coreAmount: "60000.00",
      }),
    ]);
    expect(r.findings[0]?.detail).toMatch(/nothing was paid out/);
  });

  it("a core account and payment lending never recorded: paid, unrecorded (retry to record)", () => {
    const r = reconcile([lend("k1")], [core("k1", "LN-1")], [pay("k1", "D-1")]);
    expect(r.findings[0]).toMatchObject({ kind: "CORE_ACCOUNT_PAID_UNRECORDED" });
    expect(r.findings[0]?.detail).toMatch(/Retry the booking with the same key/);
  });

  it("lending's account missing in core, a different account or principal, and payment gaps", () => {
    const r = reconcile(
      [
        booked("gone", "LN-1", "D-1"),
        booked("num", "LN-2", "D-2"),
        booked("amt", "LN-3", "D-3"),
        booked("nopay", "LN-4", "D-4"),
        booked("payamt", "LN-5", "D-5"),
        lend("nodisb", { account: { number: "LN-6", principal: Money.of("60000.00") } }),
      ],
      [
        core("num", "LN-99"),
        core("amt", "LN-3", "60000.01"),
        core("nopay", "LN-4"),
        core("payamt", "LN-5"),
        core("nodisb", "LN-6"),
      ],
      [pay("payamt", "D-5", "59999.99")],
    );
    const kinds = Object.fromEntries(r.findings.map((f) => [f.idempotencyKey, f.kind]));
    expect(kinds).toEqual({
      gone: "LENDING_ACCOUNT_MISSING_IN_CORE",
      num: "ACCOUNT_MISMATCH",
      amt: "ACCOUNT_MISMATCH",
      nopay: "PAYMENT_MISMATCH",
      payamt: "PAYMENT_MISMATCH",
      nodisb: "PAYMENT_MISMATCH",
    });
    expect(r.summary.matched).toBe(0);
  });

  it("core accounts and payments under keys lending never issued are orphans; duplicates counted", () => {
    const r = reconcile(
      [booked("k1", "LN-1", "D-1")],
      [core("k1", "LN-1", "60000.00", "app-1"), core("x1", "LN-7", "60000.00", "app-1")],
      [pay("k1", "D-1"), pay("x2", "D-9")],
    );
    expect(r.findings.map((f) => [f.kind, f.idempotencyKey])).toEqual([
      ["ORPHAN", "x1"],
      ["ORPHAN", "x2"],
    ]);
    expect(r.summary).toMatchObject({ matched: 1, duplicates: 1, findings: 2 });
  });
});

describe("every feed record is accounted for (PRD BKG-005)", () => {
  it("a payment under a lending key with no account in core or lending is a finding", () => {
    const r = reconcile([lend("k1")], [], [pay("k1", "D-1")]);
    expect(r.findings).toEqual([
      expect.objectContaining({
        kind: "PAYMENT_MISMATCH",
        idempotencyKey: "k1",
        coreAmount: "60000.00",
      }),
    ]);
  });

  it("property: over many random states, each core account and each payment is matched or in a finding, exactly once", () => {
    // A small deterministic generator (no Math.random in tests that must replay).
    let seed = 42;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 300; round += 1) {
      const keys = Array.from({ length: 6 }, (_, i) => `k${i}`);
      const lending: LendingBooking[] = [];
      const cores: CoreAccountRecord[] = [];
      const pays: PaymentRecord[] = [];
      for (const k of keys) {
        const inLending = next() < 0.7;
        const hasCore = next() < 0.6;
        const hasPay = next() < 0.5;
        const recorded = inLending && next() < 0.5;
        if (inLending) {
          lending.push(
            recorded
              ? lend(k, {
                  account: {
                    number: `LN-${k}`,
                    principal: Money.of(next() < 0.9 ? "60000.00" : "1.00"),
                  },
                  disbursement:
                    next() < 0.8 ? { reference: `D-${k}`, amount: Money.of("60000.00") } : null,
                })
              : lend(k),
          );
        }
        if (hasCore) cores.push(core(k, next() < 0.9 ? `LN-${k}` : `LN-other-${k}`));
        if (hasPay) pays.push(pay(k, next() < 0.9 ? `D-${k}` : `D-other-${k}`));
      }
      const r = reconcile(lending, cores, pays);
      const matched = new Set(r.matchedKeys);
      const findingKeys = r.findings.map((f) => f.idempotencyKey);
      // No key is both matched and a finding, and a lending key has at most one finding.
      for (const k of findingKeys) expect(matched.has(k)).toBe(false);
      const lendingKeys = new Set(lending.map((b) => b.idempotencyKey));
      const lendingFindings = findingKeys.filter((k) => lendingKeys.has(k));
      expect(new Set(lendingFindings).size).toBe(lendingFindings.length);
      // Every feed record is accounted for.
      for (const rec of [...cores, ...pays]) {
        expect(matched.has(rec.idempotencyKey) || findingKeys.includes(rec.idempotencyKey)).toBe(
          true,
        );
      }
      // Orphans: one finding per feed record outside lending.
      const orphans = r.findings.filter((f) => f.kind === "ORPHAN").length;
      const outside = [...cores, ...pays].filter((x) => !lendingKeys.has(x.idempotencyKey)).length;
      expect(orphans).toBe(outside);
      expect(r.summary.matched + r.summary.findings).toBe(matched.size + r.findings.length);
    }
  });

  it("dropSettled removes only core-ahead findings for keys lending recorded during the run", () => {
    const r = reconcile(
      [lend("in-flight"), lend("lost"), booked("gone", "LN-9", "D-9")],
      [core("in-flight", "LN-1"), core("lost", "LN-2")],
      [],
    );
    expect(r.findings.map((f) => f.kind).sort()).toEqual([
      "CORE_ACCOUNT_UNDISBURSED",
      "CORE_ACCOUNT_UNDISBURSED",
      "LENDING_ACCOUNT_MISSING_IN_CORE",
    ]);
    const settled = dropSettled(r, new Set(["in-flight", "gone"]));
    expect(settled.findings.map((f) => f.idempotencyKey).sort()).toEqual(["gone", "lost"]);
    expect(settled.summary).toMatchObject({ findings: 2, settledDuringRun: 1 });
  });
});

describe("report periods and shares (PRD RPT-001, RPT-003)", () => {
  const now = new Date("2026-11-28T03:00:00.000Z"); // 11:00 in Manila

  it("defaults to the last 30 business days, today included, as a [from, until) window", () => {
    const { period, window } = reportPeriod(undefined, undefined, now);
    expect(period).toEqual({ from: "2026-10-30", to: "2026-11-28" });
    expect(window.from.toISOString()).toBe("2026-10-29T16:00:00.000Z");
    expect(window.until.toISOString()).toBe("2026-11-28T16:00:00.000Z");
  });

  it("refuses an impossible date, a period ending before it starts, and one over 366 days", () => {
    expect(() => reportPeriod("2026-02-31", "2026-03-01", now)).toThrow(/Check the dates/);
    expect(() => reportPeriod("2026-11-28", "2026-11-27", now)).toThrow(/ends before/);
    expect(() => reportPeriod("2025-01-01", "2026-11-28", now)).toThrow(/too long/);
    // The edge: 366 days are accepted, 367 refused.
    expect(reportPeriod("2025-11-28", "2026-11-28", now).period.from).toBe("2025-11-28");
    expect(() => reportPeriod("2025-11-27", "2026-11-28", now)).toThrow(/too long/);
  });

  it("today follows the Philippine calendar: 15:59Z is still one day, 16:00Z the next", () => {
    expect(reportPeriod(undefined, undefined, new Date("2026-11-28T15:59:59.999Z")).period.to).toBe(
      "2026-11-28",
    );
    expect(reportPeriod(undefined, undefined, new Date("2026-11-28T16:00:00.000Z")).period.to).toBe(
      "2026-11-29",
    );
    const { window } = reportPeriod("2026-11-29", "2026-11-29", now);
    expect(window.from.toISOString()).toBe("2026-11-28T16:00:00.000Z");
    expect(window.until.toISOString()).toBe("2026-11-29T16:00:00.000Z");
  });

  it("shares are four-place decimal strings, and zero when there is nothing to share", () => {
    expect(share(2, 3)).toBe("0.6667");
    expect(share(3, 3)).toBe("1.0000");
    expect(share(0, 0)).toBe("0.0000");
  });
});
