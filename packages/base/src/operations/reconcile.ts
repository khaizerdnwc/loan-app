import type { CoreAccountRecord, PaymentRecord } from "@loan/contracts";
import {
  type Money,
  type ReconciliationFinding,
  ReconciliationKind,
  type ReconciliationSummary,
} from "@loan/core";

/** What lending holds for one booking request (its key), with what it recorded, if anything. */
export interface LendingBooking {
  idempotencyKey: string;
  caseId: string;
  caseReference: string;
  /** The loan account lending recorded, or null (not booked, or the reply was lost). */
  account: { number: string; principal: Money } | null;
  /** The disbursement lending recorded, or null. */
  disbursement: { reference: string; amount: Money } | null;
}

export interface Reconciliation {
  summary: ReconciliationSummary;
  findings: ReconciliationFinding[];
  /** The booking keys both sides agree on (every feed record is matched or a finding). */
  matchedKeys: string[];
}

/** Findings that say core holds what lending has not recorded (which a booking in flight also shows). */
export const CORE_AHEAD: readonly string[] = [
  ReconciliationKind.CoreAccountUndisbursed,
  ReconciliationKind.CoreAccountPaidUnrecorded,
];

const peso = (m: Money) => `₱${m.toString()}`;

/**
 * Compare lending's booking records with core's account feed and the rail's payment feed,
 * by booking key (ADR 0020: one key per booking, reused on every retry). Pure: no I/O, so it
 * is unit-tested on its own (PRD BKG-005).
 */
export function reconcile(
  lending: LendingBooking[],
  coreAccounts: CoreAccountRecord[],
  payments: PaymentRecord[],
): Reconciliation {
  const coreByKey = new Map(coreAccounts.map((a) => [a.idempotencyKey, a]));
  const payByKey = new Map(payments.map((p) => [p.idempotencyKey, p]));
  const lendingKeys = new Set(lending.map((b) => b.idempotencyKey));
  const findings: ReconciliationFinding[] = [];
  const matchedKeys: string[] = [];

  for (const b of lending) {
    const core = coreByKey.get(b.idempotencyKey) ?? null;
    const pay = payByKey.get(b.idempotencyKey) ?? null;
    const base = {
      idempotencyKey: b.idempotencyKey,
      caseId: b.caseId,
      caseReference: b.caseReference,
      coreAccountNumber: core?.accountNumber ?? null,
      lendingAccountNumber: b.account?.number ?? null,
      coreAmount: core ? core.principal.toString() : null,
      lendingAmount: b.account ? b.account.principal.toString() : null,
    };
    if (!b.account) {
      if (!core && pay) {
        // A payout with no account behind it, in core or in lending: never by the booking
        // flow (it pays only a core account), so exactly what a reconciliation must catch.
        findings.push({
          ...base,
          coreAccountNumber: pay.loanAccountNumber,
          coreAmount: pay.amount.toString(),
          kind: ReconciliationKind.PaymentMismatch,
          detail: `The payment rail paid ${peso(pay.amount)} (${pay.reference}) under this booking key, but neither core nor lending holds a loan account for it. Raise it with payments operations.`,
        });
        continue;
      }
      if (!core) continue; // Not booked in core yet: nothing to reconcile.
      findings.push(
        pay
          ? {
              ...base,
              kind: ReconciliationKind.CoreAccountPaidUnrecorded,
              detail: `Core opened account ${core.accountNumber} and the payment rail paid ${peso(pay.amount)} (${pay.reference}) under this booking key, but lending recorded neither: a reply was lost. Retry the booking with the same key to record them (core and the rail return the same account and payment); never book it again by hand.`,
            }
          : {
              ...base,
              kind: ReconciliationKind.CoreAccountUndisbursed,
              detail: `Core holds open account ${core.accountNumber} (${peso(core.principal)}) under this booking key, but lending has no loan account and nothing was paid out: core's reply was lost and no retry has completed (refused by the checklist, held for Compliance, or not tried yet). A retry that passes reuses this account; closing it in core is a manual step outside this system.`,
            },
      );
      continue;
    }
    if (!core) {
      findings.push({
        ...base,
        kind: ReconciliationKind.LendingAccountMissingInCore,
        detail: `Lending recorded account ${b.account.number}, but core holds no account under this booking key. Raise it with core banking operations; do not retry.`,
      });
      continue;
    }
    if (core.accountNumber !== b.account.number || !core.principal.equals(b.account.principal)) {
      findings.push({
        ...base,
        kind: ReconciliationKind.AccountMismatch,
        detail: `Lending recorded ${b.account.number} for ${peso(b.account.principal)}; core holds ${core.accountNumber} for ${peso(core.principal)} under the same key. Raise it with core banking operations.`,
      });
      continue;
    }
    const d = b.disbursement;
    if (!d || !pay || pay.reference !== d.reference || !pay.amount.equals(d.amount)) {
      findings.push({
        ...base,
        kind: ReconciliationKind.PaymentMismatch,
        detail: !d
          ? "Lending recorded the loan account but no disbursement. Raise it with payments operations."
          : !pay
            ? `Lending recorded disbursement ${d.reference} for ${peso(d.amount)}, but the payment rail holds no payment under this key. Raise it with payments operations.`
            : `Lending recorded ${d.reference} for ${peso(d.amount)}; the rail holds ${pay.reference} for ${peso(pay.amount)}. Raise it with payments operations.`,
      });
      continue;
    }
    matchedKeys.push(b.idempotencyKey);
  }

  for (const a of coreAccounts) {
    if (lendingKeys.has(a.idempotencyKey)) continue;
    findings.push({
      kind: ReconciliationKind.Orphan,
      idempotencyKey: a.idempotencyKey,
      caseId: null,
      caseReference: null,
      coreAccountNumber: a.accountNumber,
      lendingAccountNumber: null,
      coreAmount: a.principal.toString(),
      lendingAmount: null,
      detail: `Core holds account ${a.accountNumber} (${peso(a.principal)}) under a booking key lending never issued. Raise it with core banking operations.`,
    });
  }
  for (const p of payments) {
    if (lendingKeys.has(p.idempotencyKey)) continue;
    findings.push({
      kind: ReconciliationKind.Orphan,
      idempotencyKey: p.idempotencyKey,
      caseId: null,
      caseReference: null,
      coreAccountNumber: p.loanAccountNumber,
      lendingAccountNumber: null,
      coreAmount: p.amount.toString(),
      lendingAmount: null,
      detail: `The payment rail paid ${peso(p.amount)} (${p.reference}) under a booking key lending never issued. Raise it with payments operations.`,
    });
  }

  const perApplication = new Map<string, number>();
  for (const a of coreAccounts) {
    perApplication.set(a.applicationId, (perApplication.get(a.applicationId) ?? 0) + 1);
  }
  const duplicates = [...perApplication.values()].filter((n) => n > 1).length;

  return {
    summary: {
      bookingRequests: lending.length,
      matched: matchedKeys.length,
      coreAccounts: coreAccounts.length,
      payments: payments.length,
      findings: findings.length,
      duplicates,
      settledDuringRun: 0,
    },
    findings,
    matchedKeys,
  };
}

/**
 * Drop the "core holds it, lending has not recorded it" findings for keys lending recorded
 * by the end of the run: those bookings were in flight while the feeds were read (core and
 * the rail commit before lending), not lost replies. Runs are stored insert-only, so a false
 * finding must not be kept.
 */
export function dropSettled(
  result: Reconciliation,
  settledKeys: ReadonlySet<string>,
): Reconciliation {
  const findings = result.findings.filter(
    (f) => !(CORE_AHEAD.includes(f.kind) && settledKeys.has(f.idempotencyKey)),
  );
  return {
    ...result,
    findings,
    summary: {
      ...result.summary,
      findings: findings.length,
      settledDuringRun: result.findings.length - findings.length,
    },
  };
}
