import "reflect-metadata";
import type { CoreLoanAccount } from "@loan/contracts";
import { Money, ProviderMode } from "@loan/core";
import { assertReconciles, ReconciliationError } from "../../src/cases/booking.service";

/** ₱1,000.00 at 1% a month over 3 months: interest ₱30.00, instalments 343.33 / 343.33 / 343.34. */
function account(): CoreLoanAccount {
  const line = (n: number, principal: string, interest: string, amount: string) => ({
    number: n,
    dueDate: `2027-0${n}-15`,
    principal: Money.of(principal),
    interest: Money.of(interest),
    amount: Money.of(amount),
  });
  return {
    provider: "test",
    mode: ProviderMode.Simulated,
    idempotencyKey: "bk-test",
    accountNumber: "LN-1",
    principal: Money.of("1000.00"),
    interest: Money.of("30.00"),
    totalRepayable: Money.of("1030.00"),
    schedule: [
      line(1, "333.33", "10.00", "343.33"),
      line(2, "333.33", "10.00", "343.33"),
      line(3, "333.34", "10.00", "343.34"),
    ],
    openedAt: "2026-11-27T00:00:00.000Z",
  };
}

describe("assertReconciles (ADR 0019 R6): booking refuses a schedule that does not add up", () => {
  it("accepts a schedule that reconciles exactly", () => {
    expect(() => assertReconciles(account(), Money.of("1000.00"), 3)).not.toThrow();
  });

  it("refuses an instalment one centavo off", () => {
    const a = account();
    const last = a.schedule[2];
    if (!last) throw new Error("fixture");
    a.schedule[2] = { ...last, amount: Money.of("343.35"), interest: Money.of("10.01") };
    expect(() => assertReconciles(a, Money.of("1000.00"), 3)).toThrow(
      /instalments do not add up to principal plus interest/,
    );
  });

  it("refuses a principal other than the approved amount", () => {
    expect(() => assertReconciles(account(), Money.of("1000.01"), 3)).toThrow(
      /principal differs from the approved amount/,
    );
  });

  it("refuses the wrong number of instalments", () => {
    expect(() => assertReconciles(account(), Money.of("1000.00"), 4)).toThrow(
      /3 instalments for a 4-month loan/,
    );
  });

  it("refuses principal parts that do not add up, even when instalments do", () => {
    const a = account();
    const [l1, l2] = a.schedule;
    if (!l1 || !l2) throw new Error("fixture");
    a.schedule[0] = { ...l1, principal: Money.of("333.34"), interest: Money.of("9.99") };
    expect(() => assertReconciles(a, Money.of("1000.00"), 3)).toThrow(ReconciliationError);
  });

  it("refuses a total repayable that is not principal plus interest", () => {
    const a = { ...account(), totalRepayable: Money.of("1030.01") };
    expect(() => assertReconciles(a, Money.of("1000.00"), 3)).toThrow(
      /total repayable is not principal plus interest/,
    );
  });
});
