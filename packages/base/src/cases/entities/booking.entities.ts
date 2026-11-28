import type { Money, ProviderMode } from "@loan/core";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { moneyColumn } from "../../database/money.transformer";
import { LoanCaseEntity } from "./loan-case.entity";

export type BookingStatus = "PENDING" | "BOOKED" | "FAILED";

/**
 * The maker's booking request (ADR 0020 R1). One per case, with one idempotency key that
 * every attempt — first or retry — sends to core banking and disbursement.
 */
@Entity({ name: "booking_request" })
export class BookingRequestEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid", unique: true })
  caseId!: string;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_booking_request_case" })
  loanCase?: Relation<LoanCaseEntity>;

  @Column({ name: "idempotency_key", type: "varchar", length: 60, unique: true })
  idempotencyKey!: string;

  @Column({ type: "varchar", length: 10 })
  status!: BookingStatus;

  @Column({ name: "maker_id", type: "varchar", length: 40 })
  makerId!: string;

  @Column({ name: "checker_id", type: "varchar", length: 40, nullable: true })
  checkerId!: string | null;

  @Column({ type: "integer", default: 0 })
  attempts!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

/** The loan as core banking opened it (ADR 0020 R3: one per case, one per core account). */
@Entity({ name: "loan_account" })
export class LoanAccountEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "case_id", type: "uuid", unique: true })
  caseId!: string;

  @ManyToOne(() => LoanCaseEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "case_id", foreignKeyConstraintName: "FK_loan_account_case" })
  loanCase?: Relation<LoanCaseEntity>;

  @Column({ name: "core_account_number", type: "varchar", length: 30, unique: true })
  coreAccountNumber!: string;

  @Column({ name: "booking_request_id", type: "uuid" })
  bookingRequestId!: string;

  @ManyToOne(() => BookingRequestEntity, { onDelete: "NO ACTION" })
  @JoinColumn({
    name: "booking_request_id",
    foreignKeyConstraintName: "FK_loan_account_booking_request",
  })
  bookingRequest?: Relation<BookingRequestEntity>;

  @Column(moneyColumn())
  principal!: Money;

  @Column(moneyColumn())
  interest!: Money;

  @Column(moneyColumn({ name: "total_repayable" }))
  totalRepayable!: Money;

  @Column({ name: "monthly_rate", type: "varchar", length: 10 })
  monthlyRate!: string;

  @Column({ name: "tenor_months", type: "integer" })
  tenorMonths!: number;

  @Column({ name: "opened_at", type: "timestamptz" })
  openedAt!: Date;

  @Column({ name: "provider_mode", type: "varchar", length: 12 })
  providerMode!: ProviderMode;

  @OneToMany(
    () => ScheduleLineEntity,
    (line) => line.loanAccount,
  )
  schedule!: ScheduleLineEntity[];
}

@Entity({ name: "schedule_line" })
@Index(["loanAccountId", "number"], { unique: true })
export class ScheduleLineEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "loan_account_id", type: "uuid" })
  loanAccountId!: string;

  @ManyToOne(
    () => LoanAccountEntity,
    (account) => account.schedule,
    { onDelete: "NO ACTION" },
  )
  @JoinColumn({
    name: "loan_account_id",
    foreignKeyConstraintName: "FK_schedule_line_loan_account",
  })
  loanAccount?: Relation<LoanAccountEntity>;

  @Column({ type: "integer" })
  number!: number;

  @Column({ name: "due_date", type: "date" })
  dueDate!: string;

  @Column(moneyColumn())
  principal!: Money;

  @Column(moneyColumn())
  interest!: Money;

  @Column(moneyColumn())
  amount!: Money;
}

/** One disbursement per loan account, keyed by the booking key (ADR 0020 R3, R6). */
@Entity({ name: "disbursement" })
export class DisbursementEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "loan_account_id", type: "uuid", unique: true })
  loanAccountId!: string;

  @ManyToOne(() => LoanAccountEntity, { onDelete: "NO ACTION" })
  @JoinColumn({ name: "loan_account_id", foreignKeyConstraintName: "FK_disbursement_loan_account" })
  loanAccount?: Relation<LoanAccountEntity>;

  @Column({ name: "idempotency_key", type: "varchar", length: 60, unique: true })
  idempotencyKey!: string;

  @Column({ type: "varchar", length: 40 })
  reference!: string;

  @Column(moneyColumn())
  amount!: Money;

  @Column({ name: "destination_account", type: "varchar", length: 40 })
  destinationAccount!: string;

  @Column({ name: "disbursed_at", type: "timestamptz" })
  disbursedAt!: Date;

  @Column({ name: "provider_mode", type: "varchar", length: 12 })
  providerMode!: ProviderMode;
}
