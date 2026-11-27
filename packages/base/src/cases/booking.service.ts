import { randomUUID } from "node:crypto";
import {
  CORE_BANKING,
  type CoreBanking,
  type CoreLoanAccount,
  DISBURSEMENT,
  type Disbursement,
  isProviderUnavailable,
} from "@loan/contracts";
import { type CaseDetail, CaseStatus, Money, ProblemCode, Role } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { TransactionRunner } from "../database/transaction-runner";
import { ActivityService } from "./activity.service";
import { bookingChecklist, checklistRefusal } from "./booking-checklist";
import { canView } from "./case-access";
import { CasesRepository } from "./cases.repository";
import { CasesService } from "./cases.service";
import { DomainError, forbiddenRole, invalidState, makerChecker, notFound } from "./domain-error";
import { BookingRequestEntity } from "./entities/booking.entities";
import type { LoanCaseEntity } from "./entities/loan-case.entity";
import { assertTransition, type CaseEvent, InvalidTransitionError, moveTo } from "./lifecycle";
import { businessDate } from "./product";

/**
 * Booking and disbursement (ADR 0020).
 *
 * Maker: loan operations (or a supervisor) submits; one booking request per case, one
 * idempotency key, kept for every attempt.
 * Checker: a supervisor who is not the maker approves. In one transaction, with the case
 * row locked: re-check the status, book in core with the key, disburse with the key, check
 * the schedule reconciles (ADR 0019 R6), store account + schedule + disbursement + status +
 * activity. A provider failure rolls that back, then marks the booking FAILED in its own
 * transaction; a retry repeats the same steps with the same key.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CasesRepository,
    private readonly activity: ActivityService,
    private readonly cases: CasesService,
    @Inject(CORE_BANKING) private readonly core: CoreBanking,
    @Inject(DISBURSEMENT) private readonly disbursement: Disbursement,
  ) {}

  /** Maker step. A second submit returns the existing request (B-1). */
  async submit(user: SessionUser, id: string): Promise<CaseDetail> {
    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      const existing = await this.repo.findBooking(c.id, m);
      if (existing) return;
      this.assert("SUBMIT_BOOKING", c.status);
      await this.assertChecklist(m, c);
      const booking = new BookingRequestEntity();
      booking.caseId = c.id;
      booking.idempotencyKey = `bk-${randomUUID()}`;
      booking.status = "PENDING";
      booking.makerId = user.id;
      booking.checkerId = null;
      booking.attempts = 0;
      booking.lastError = null;
      await this.repo.saveBooking(m, booking);
      this.move(c, "SUBMIT_BOOKING", CaseStatus.PendingChecker);
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "BOOKING_SUBMITTED",
        summary: `Submitted the booking for a checker (key ${booking.idempotencyKey}).`,
        fromStatus: CaseStatus.Booking,
        toStatus: CaseStatus.PendingChecker,
        details: { idempotencyKey: booking.idempotencyKey },
      });
    });
    return this.cases.get(user, id);
  }

  /** Checker step, and the retry after a failure (same endpoint, same key). */
  async approve(user: SessionUser, id: string): Promise<CaseDetail> {
    if (user.role !== Role.LoanOperationsSupervisor) {
      throw forbiddenRole("Only a loan operations supervisor can approve a booking.");
    }
    let failure: { code: ProblemCode; detail: string } | null = null;
    try {
      await this.tx.run((m) => this.book(m, user, id));
    } catch (err) {
      if (!isProviderUnavailable(err) && !(err instanceof ReconciliationError)) throw err;
      failure = isProviderUnavailable(err)
        ? {
            code: ProblemCode.ProviderUnavailable,
            detail: `${serviceLabel(err.service)} ${err.failure === "TIMEOUT" ? "did not answer in time" : err.failure === "MALFORMED" ? "sent a reply that could not be read" : "is unavailable"}. Nothing was booked twice: retry with the same key.`,
          }
        : { code: ProblemCode.ScheduleMismatch, detail: err.message };
      await this.tx.run((m) =>
        this.markFailed(m, user, id, failure as { code: ProblemCode; detail: string }),
      );
    }
    if (failure) {
      throw new DomainError(
        failure.code === ProblemCode.ScheduleMismatch ? 502 : 503,
        failure.code,
        failure.detail,
      );
    }
    return this.cases.get(user, id);
  }

  private async book(m: EntityManager, user: SessionUser, id: string): Promise<void> {
    const c = await this.lock(m, user, id);
    const fromStatus = c.status;
    this.assert("BOOKING_SUCCEEDED", c.status);
    const booking = await this.repo.findBooking(c.id, m);
    if (!booking) throw invalidState("There is no booking request to approve.");
    if (booking.makerId === user.id) {
      throw makerChecker("You submitted this booking; a different supervisor must approve it.");
    }
    // The checklist again at the checker step (and on a retry): something may have changed
    // since the maker submitted. Under the row lock; refused with nothing written.
    await this.assertChecklist(m, c);
    if (!c.approvedAmount || !c.approvedTenorMonths || !c.approvedMonthlyRate) {
      throw invalidState("This case has no approved terms.");
    }

    const account = await this.core.bookLoan({
      idempotencyKey: booking.idempotencyKey,
      applicationId: c.id,
      customerRef: c.applicantId,
      terms: {
        principal: c.approvedAmount,
        monthlyRate: c.approvedMonthlyRate,
        tenorMonths: c.approvedTenorMonths,
      },
      bookingDate: businessDate(),
    });
    assertReconciles(account, c.approvedAmount, c.approvedTenorMonths);
    const receipt = await this.disbursement.disburse({
      idempotencyKey: booking.idempotencyKey,
      loanAccountNumber: account.accountNumber,
      amount: account.principal,
      destinationAccount: c.applicant.depositAccount,
    });

    await this.repo.insertLoan(
      m,
      {
        caseId: c.id,
        coreAccountNumber: account.accountNumber,
        bookingRequestId: booking.id,
        principal: account.principal,
        interest: account.interest,
        totalRepayable: account.totalRepayable,
        monthlyRate: c.approvedMonthlyRate,
        tenorMonths: c.approvedTenorMonths,
        openedAt: new Date(account.openedAt),
        providerMode: account.mode,
      },
      account.schedule.map((l) => ({
        number: l.number,
        dueDate: l.dueDate,
        principal: l.principal,
        interest: l.interest,
        amount: l.amount,
      })),
      {
        idempotencyKey: receipt.idempotencyKey,
        reference: receipt.reference,
        amount: receipt.amount,
        destinationAccount: receipt.destinationAccount,
        disbursedAt: new Date(receipt.disbursedAt),
        providerMode: receipt.mode,
      },
    );
    booking.status = "BOOKED";
    booking.checkerId = user.id;
    booking.attempts += 1;
    booking.lastError = null;
    await this.repo.saveBooking(m, booking);
    this.move(c, "BOOKING_SUCCEEDED", CaseStatus.Disbursed);
    await this.repo.saveCase(m, c);
    await this.activity.record(m, {
      caseId: c.id,
      actor: user,
      action: fromStatus === CaseStatus.BookingFailed ? "BOOKING_RETRIED" : "BOOKING_APPROVED",
      summary: `Booked loan ${account.accountNumber} (₱${account.principal.toString()} + ₱${account.interest.toString()} interest, ${account.schedule.length} instalments) and disbursed ₱${receipt.amount.toString()} to ${receipt.destinationAccount} (${receipt.reference}).`,
      fromStatus,
      toStatus: CaseStatus.Disbursed,
      details: {
        idempotencyKey: booking.idempotencyKey,
        accountNumber: account.accountNumber,
        disbursementReference: receipt.reference,
        attempt: booking.attempts,
      },
    });
  }

  private async markFailed(
    m: EntityManager,
    user: SessionUser,
    id: string,
    failure: { code: ProblemCode; detail: string },
  ): Promise<void> {
    const c = await this.lock(m, user, id);
    const booking = await this.repo.findBooking(c.id, m);
    if (!booking || c.status === CaseStatus.Disbursed) return;
    const fromStatus = c.status;
    booking.status = "FAILED";
    booking.attempts += 1;
    booking.checkerId = user.id;
    booking.lastError = `${failure.code}: ${failure.detail}`;
    await this.repo.saveBooking(m, booking);
    this.move(c, "BOOKING_FAILED", CaseStatus.BookingFailed);
    await this.repo.saveCase(m, c);
    await this.activity.record(m, {
      caseId: c.id,
      actor: user,
      action: "BOOKING_FAILED",
      summary: `Booking attempt ${booking.attempts} failed: ${failure.detail}`,
      fromStatus,
      toStatus: CaseStatus.BookingFailed,
      details: { idempotencyKey: booking.idempotencyKey, code: failure.code },
    });
  }

  /**
   * The pre-booking checklist (BKG-001), read in the caller's transaction under the row lock:
   * 409 BOOKING_CHECKLIST_INCOMPLETE naming the first failing item, so nothing is written.
   */
  private async assertChecklist(m: EntityManager, c: LoanCaseEntity): Promise<void> {
    const decision = c.decisionId ? await this.repo.findDecision(c.decisionId, m) : null;
    const refusal = checklistRefusal(bookingChecklist(c, decision, new Date()));
    if (refusal) throw new DomainError(409, ProblemCode.BookingChecklistIncomplete, refusal);
  }

  private async lock(m: EntityManager, user: SessionUser, id: string): Promise<LoanCaseEntity> {
    const c = await this.repo.lockCase(m, id);
    if (!c || !canView(user, c)) throw notFound();
    return c;
  }

  private assert(event: CaseEvent, from: CaseStatus): void {
    this.guard(from, () => assertTransition(event, from));
  }

  private move(c: LoanCaseEntity, event: CaseEvent, to: CaseStatus): void {
    this.guard(c.status, () => moveTo(c, event, to));
  }

  private guard(from: CaseStatus, check: () => void): void {
    try {
      check();
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw invalidState(
          from === CaseStatus.Disbursed
            ? "This loan is already booked and disbursed."
            : err.message,
        );
      }
      throw err;
    }
  }
}

export class ReconciliationError extends Error {}

/**
 * ADR 0019 R6: refuse a booking whose schedule does not reconcile exactly — whatever core
 * banking says. Σ instalments = principal + interest; Σ principal parts = principal; Σ
 * interest parts = interest; principal = the approved amount; one line per month.
 */
export function assertReconciles(account: CoreLoanAccount, approved: Money, tenor: number): void {
  const lines = account.schedule;
  const problems: string[] = [];
  if (!account.principal.equals(approved))
    problems.push("principal differs from the approved amount");
  if (lines.length !== tenor)
    problems.push(`${lines.length} instalments for a ${tenor}-month loan`);
  if (!Money.sum(lines.map((l) => l.amount)).equals(account.principal.plus(account.interest))) {
    problems.push("instalments do not add up to principal plus interest");
  }
  if (!Money.sum(lines.map((l) => l.principal)).equals(account.principal)) {
    problems.push("principal parts do not add up to the principal");
  }
  if (!Money.sum(lines.map((l) => l.interest)).equals(account.interest)) {
    problems.push("interest parts do not add up to the interest");
  }
  if (!account.totalRepayable.equals(account.principal.plus(account.interest))) {
    problems.push("total repayable is not principal plus interest");
  }
  if (problems.length) {
    throw new ReconciliationError(`Core banking's schedule was refused: ${problems.join("; ")}.`);
  }
}

function serviceLabel(service: string): string {
  return service === "DISBURSEMENT" ? "The disbursement service" : "Core banking";
}
