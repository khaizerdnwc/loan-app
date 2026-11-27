import {
  CORE_BANKING,
  type CoreAccountRecord,
  type CoreBanking,
  DISBURSEMENT,
  type Disbursement,
  isProviderUnavailable,
  type PaymentRecord,
} from "@loan/contracts";
import {
  type BookingExceptionView,
  NO_FEED_RECORDS,
  ProblemCode,
  type ReconciliationKind,
  type ReconciliationRunSummaryView,
  type ReconciliationRunView,
  ServiceName,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import { bookingChecklist, checklistRefusal } from "../cases/booking-checklist";
import { CasesRepository } from "../cases/cases.repository";
import { DomainError } from "../cases/domain-error";
import { ComplianceService } from "../compliance/compliance.service";
import { TransactionRunner } from "../database/transaction-runner";
import { ReconciliationRunEntity } from "./entities/reconciliation-run.entity";
import { OperationsRepository } from "./operations.repository";
import { CORE_AHEAD, dropSettled, reconcile } from "./reconcile";

/**
 * Booking exceptions and reconciliation (PRD BKG-005). The exception list is read-only (the
 * retry itself stays on the case, under the booking rules). A reconciliation run reads
 * lending's records first, then core's account feed and the rail's payment feed through
 * their ports, compares them by booking key, and stores the result insert-only with its
 * audit entry in one transaction (one connection: the insert and the audit append). It
 * changes no case, account or payment.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: OperationsRepository,
    private readonly cases: CasesRepository,
    private readonly staff: StaffRepository,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
    @Inject(CORE_BANKING) private readonly core: CoreBanking,
    @Inject(DISBURSEMENT) private readonly disbursement: Disbursement,
  ) {}

  async exceptions(): Promise<BookingExceptionView[]> {
    const failed = await this.repo.failedBookings();
    const latest = await this.repo.latestRun();
    const kindByKey = new Map<string, ReconciliationKind>(
      (latest?.findings ?? []).map((f) => [f.idempotencyKey, f.kind]),
    );
    const now = new Date();
    const out: BookingExceptionView[] = [];
    for (const { c, booking } of failed) {
      const decision = c.decisionId ? await this.cases.findDecision(c.decisionId) : null;
      const hold = await this.compliance.bookingHold(c.id);
      out.push({
        caseId: c.id,
        caseReference: c.reference,
        applicantName: c.applicant.fullName,
        amount: (c.approvedAmount ?? c.requestedAmount).toString(),
        idempotencyKey: booking.idempotencyKey,
        attempts: booking.attempts,
        lastError: booking.lastError,
        lastAttemptAt: booking.updatedAt.toISOString(),
        blockedReason: hold ?? checklistRefusal(bookingChecklist(c, decision, now)),
        reconciliation: kindByKey.get(booking.idempotencyKey) ?? null,
      });
    }
    return out;
  }

  async run(user: SessionUser): Promise<ReconciliationRunView> {
    // Lending first: a booking that commits while the feeds are read then shows as a core
    // account lending has not recorded yet (which says "retry"), never as missing in core.
    const lending = await this.repo.lendingBookings();
    let accounts: CoreAccountRecord[];
    let payments: PaymentRecord[];
    try {
      [accounts, payments] = await Promise.all([
        this.core.listAccounts(),
        this.disbursement.listPayments(),
      ]);
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      const who = err.service === ServiceName.Disbursement ? "The payment rail" : "Core banking";
      throw new DomainError(
        503,
        ProblemCode.ProviderUnavailable,
        `${who} could not answer, so nothing was reconciled and no run was recorded. Try again once it is back.`,
      );
    }
    const first = reconcile(lending, accounts, payments);
    // A booking that committed while the feeds were read shows as "core ahead of lending":
    // read those keys again and drop the ones lending has recorded since.
    const ahead = first.findings.filter((f) => CORE_AHEAD.includes(f.kind));
    const settled = new Set(
      ahead.length
        ? (await this.repo.lendingBookings(ahead.map((f) => f.idempotencyKey)))
            .filter((b) => b.account !== null)
            .map((b) => b.idempotencyKey)
        : [],
    );
    const { summary, findings } = dropSettled(first, settled);
    const saved = await this.tx.run(async (m) => {
      const run = new ReconciliationRunEntity();
      run.runBy = user.id;
      // The mode comes from the feeds (never a literal here); empty feeds carry none.
      run.providerMode = accounts[0]?.mode ?? payments[0]?.mode ?? NO_FEED_RECORDS;
      run.summary = summary;
      run.findings = findings;
      const stored = await this.repo.insertRun(m, run);
      await this.audit.append(m, {
        actor: user,
        action: "RECONCILIATION_RUN",
        summary: `Reconciled ${summary.bookingRequests} booking(s) with core banking and the payment rail: ${summary.matched} matched, ${summary.findings} finding(s), ${summary.duplicates} duplicate(s).`,
        details: { runId: stored.id, ...summary },
      });
      return stored;
    });
    return this.view(saved);
  }

  async latest(): Promise<ReconciliationRunView | null> {
    const run = await this.repo.latestRun();
    return run ? this.view(run) : null;
  }

  async history(): Promise<ReconciliationRunSummaryView[]> {
    const runs = await this.repo.runs(20);
    const names = await this.staff.namesById([...new Set(runs.map((r) => r.runBy))]);
    return runs.map((r) => ({
      id: r.id,
      runAt: r.runAt.toISOString(),
      runByName: names.get(r.runBy) ?? r.runBy,
      summary: r.summary,
    }));
  }

  private async view(run: ReconciliationRunEntity): Promise<ReconciliationRunView> {
    const names = await this.staff.namesById([run.runBy]);
    return {
      id: run.id,
      runAt: run.runAt.toISOString(),
      runByName: names.get(run.runBy) ?? run.runBy,
      providerMode: run.providerMode,
      summary: run.summary,
      findings: run.findings,
    };
  }
}
