import { CaseStatus, Money } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager, In } from "typeorm";
import { BookingRequestEntity } from "../cases/entities/booking.entities";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { ReconciliationRunEntity } from "./entities/reconciliation-run.entity";
import type { LendingBooking } from "./reconcile";

/** Storage reads for booking exceptions and reconciliation (house/no-datasource-outside-repository). */
@Injectable()
export class OperationsRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Cases whose booking failed or is held, oldest change first (they wait longest). */
  async failedBookings(): Promise<{ c: LoanCaseEntity; booking: BookingRequestEntity }[]> {
    const cases = await this.ds.getRepository(LoanCaseEntity).find({
      where: { status: CaseStatus.BookingFailed },
      order: { updatedAt: "ASC", id: "ASC" },
      take: 500,
    });
    if (cases.length === 0) return [];
    const bookings = await this.ds
      .getRepository(BookingRequestEntity)
      .find({ where: { caseId: In(cases.map((c) => c.id)) } });
    const byCase = new Map(bookings.map((b) => [b.caseId, b]));
    return cases.flatMap((c) => {
      const booking = byCase.get(c.id);
      return booking ? [{ c, booking }] : [];
    });
  }

  /** Every booking request with what lending recorded for it (one read, one snapshot). */
  async lendingBookings(keys?: string[]): Promise<LendingBooking[]> {
    const rows: {
      idempotency_key: string;
      case_id: string;
      reference: string;
      core_account_number: string | null;
      principal: string | null;
      disbursement_reference: string | null;
      disbursement_amount: string | null;
    }[] = await this.ds.query(
      `SELECT b.idempotency_key, b.case_id, c.reference, la.core_account_number, la.principal,
              d.reference AS disbursement_reference, d.amount AS disbursement_amount
         FROM booking_request b
         JOIN loan_case c ON c.id = b.case_id
         LEFT JOIN loan_account la ON la.case_id = b.case_id
         LEFT JOIN disbursement d ON d.loan_account_id = la.id
        WHERE $1::text[] IS NULL OR b.idempotency_key = ANY($1::text[])
        ORDER BY b.created_at, b.idempotency_key`,
      [keys ?? null],
    );
    return rows.map((r) => ({
      idempotencyKey: r.idempotency_key,
      caseId: r.case_id,
      caseReference: r.reference,
      account:
        r.core_account_number && r.principal
          ? { number: r.core_account_number, principal: Money.of(r.principal) }
          : null,
      disbursement:
        r.disbursement_reference && r.disbursement_amount
          ? { reference: r.disbursement_reference, amount: Money.of(r.disbursement_amount) }
          : null,
    }));
  }

  async insertRun(
    m: EntityManager,
    run: ReconciliationRunEntity,
  ): Promise<ReconciliationRunEntity> {
    return m.getRepository(ReconciliationRunEntity).save(run);
  }

  async latestRun(): Promise<ReconciliationRunEntity | null> {
    const [run] = await this.ds
      .getRepository(ReconciliationRunEntity)
      .find({ order: { runAt: "DESC", id: "ASC" }, take: 1 });
    return run ?? null;
  }

  async runs(limit: number): Promise<ReconciliationRunEntity[]> {
    return this.ds
      .getRepository(ReconciliationRunEntity)
      .find({ order: { runAt: "DESC", id: "ASC" }, take: limit });
  }

  async findRun(id: string): Promise<ReconciliationRunEntity | null> {
    return this.ds.getRepository(ReconciliationRunEntity).findOne({ where: { id } });
  }
}
