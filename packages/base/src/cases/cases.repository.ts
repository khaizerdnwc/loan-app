import { CaseStatus, CLOSED_CASE_STATUSES, Role } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { type EntityManager, In, Not, type Repository } from "typeorm";
import type { SessionUser } from "../auth/session";
import { ActivityEventEntity } from "./entities/activity-event.entity";
import { ApplicantEntity } from "./entities/applicant.entity";
import {
  BookingRequestEntity,
  DisbursementEntity,
  LoanAccountEntity,
  ScheduleLineEntity,
} from "./entities/booking.entities";
import { ConsentRecordEntity } from "./entities/consent-record.entity";
import { DecisionRecordEntity } from "./entities/decision-record.entity";
import { LoanCaseEntity } from "./entities/loan-case.entity";

/** The stages each role works on (docs/API.md "Who sees what"). */
export const OPERATIONS_STAGES: CaseStatus[] = [
  CaseStatus.Offer,
  CaseStatus.Booking,
  CaseStatus.PendingChecker,
  CaseStatus.BookingFailed,
  CaseStatus.Disbursed,
];

/**
 * All SQL for loan cases and what hangs off them. Reads use the default manager; every
 * write takes the manager of the caller's transaction.
 */
@Injectable()
export class CasesRepository {
  constructor(
    @InjectRepository(LoanCaseEntity) private readonly cases: Repository<LoanCaseEntity>,
    @InjectRepository(ApplicantEntity) private readonly applicants: Repository<ApplicantEntity>,
  ) {}

  listApplicants(): Promise<ApplicantEntity[]> {
    return this.applicants.find({ order: { fullName: "ASC" } });
  }

  findApplicant(id: string, manager?: EntityManager): Promise<ApplicantEntity | null> {
    return (manager?.getRepository(ApplicantEntity) ?? this.applicants).findOne({ where: { id } });
  }

  findCase(id: string): Promise<LoanCaseEntity | null> {
    return this.cases.findOne({ where: { id } });
  }

  /**
   * Load a case and lock its row until the transaction ends (SELECT … FOR UPDATE). Two
   * requests acting on the same case are serialised here, so the second one sees the
   * first one's status — the basis of the booking guarantee (ADR 0020 R2).
   */
  async lockCase(manager: EntityManager, id: string): Promise<LoanCaseEntity | null> {
    const locked = await manager
      .getRepository(LoanCaseEntity)
      .createQueryBuilder("c")
      .setLock("pessimistic_write")
      .where("c.id = :id", { id })
      .getOne();
    if (!locked) return null;
    // The lock is taken on loan_case alone; load the applicant without extending it.
    locked.applicant = (await this.findApplicant(locked.applicantId, manager)) as ApplicantEntity;
    return locked;
  }

  async nextReference(manager: EntityManager): Promise<string> {
    const [{ n }] = (await manager.query("SELECT nextval('loan_case_ref_seq') AS n")) as [
      { n: string },
    ];
    return `APP-${n}`;
  }

  /** The cases a role works on now (`queue`) or may look at (`all`). */
  list(user: SessionUser, view: "queue" | "all"): Promise<LoanCaseEntity[]> {
    const order = { updatedAt: "DESC" as const };
    switch (user.role) {
      case Role.LoanOfficer:
        return view === "queue"
          ? this.cases.find({ where: { status: In([CaseStatus.Draft, CaseStatus.Review]) }, order })
          : this.cases.find({ order });
      case Role.Approver:
        return view === "queue"
          ? this.cases.find({ where: { status: CaseStatus.Approval }, order })
          : this.cases.find({
              where: [{ status: CaseStatus.Approval }, { approvedBy: user.id }],
              order,
            });
      case Role.LoanOperations:
      case Role.LoanOperationsSupervisor:
        return view === "queue"
          ? this.cases.find({
              where: {
                status: In(
                  user.role === Role.LoanOperations
                    ? [CaseStatus.Offer, CaseStatus.Booking]
                    : [
                        CaseStatus.Offer,
                        CaseStatus.Booking,
                        CaseStatus.PendingChecker,
                        CaseStatus.BookingFailed,
                      ],
                ),
              },
              order,
            })
          : this.cases.find({ where: { status: In(OPERATIONS_STAGES) }, order });
      case Role.Compliance:
        return this.cases.find({ order });
      default:
        return Promise.resolve([]);
    }
  }

  saveCase(manager: EntityManager, c: LoanCaseEntity): Promise<LoanCaseEntity> {
    return manager.getRepository(LoanCaseEntity).save(c);
  }

  // --- decision records (insert-only) ----------------------------------------------------

  async insertDecision(
    manager: EntityManager,
    record: Partial<DecisionRecordEntity>,
  ): Promise<DecisionRecordEntity> {
    const repo = manager.getRepository(DecisionRecordEntity);
    const result = await repo.insert(record);
    const id = result.identifiers[0]?.id as string;
    return (await repo.findOne({ where: { id } })) as DecisionRecordEntity;
  }

  findDecision(id: string): Promise<DecisionRecordEntity | null> {
    return this.cases.manager.getRepository(DecisionRecordEntity).findOne({ where: { id } });
  }

  // --- history -----------------------------------------------------------------------------

  /** The applicant's open application for the product (not declined or disbursed), if any. */
  findOpenCase(
    applicantId: string,
    productCode: string,
    manager?: EntityManager,
  ): Promise<LoanCaseEntity | null> {
    return (manager ?? this.cases.manager).getRepository(LoanCaseEntity).findOne({
      where: {
        applicantId,
        productCode,
        status: Not(In([...CLOSED_CASE_STATUSES])),
      },
      order: { createdAt: "ASC" },
    });
  }

  async insertConsent(
    manager: EntityManager,
    record: Partial<ConsentRecordEntity>,
  ): Promise<ConsentRecordEntity> {
    const repo = manager.getRepository(ConsentRecordEntity);
    const result = await repo.insert(record);
    const id = result.identifiers[0]?.id as string;
    return (await repo.findOne({ where: { id } })) as ConsentRecordEntity;
  }

  /** The latest consent recorded for the case (insert-only: the newest one applies). */
  latestConsent(caseId: string, manager?: EntityManager): Promise<ConsentRecordEntity | null> {
    return (manager ?? this.cases.manager)
      .getRepository(ConsentRecordEntity)
      .findOne({ where: { caseId }, order: { capturedAt: "DESC", id: "DESC" } });
  }

  activity(caseId: string): Promise<ActivityEventEntity[]> {
    return this.cases.manager
      .getRepository(ActivityEventEntity)
      .find({ where: { caseId }, order: { createdAt: "ASC" } });
  }

  // --- booking -----------------------------------------------------------------------------

  findBooking(caseId: string, manager?: EntityManager): Promise<BookingRequestEntity | null> {
    return (manager ?? this.cases.manager)
      .getRepository(BookingRequestEntity)
      .findOne({ where: { caseId } });
  }

  saveBooking(manager: EntityManager, b: BookingRequestEntity): Promise<BookingRequestEntity> {
    return manager.getRepository(BookingRequestEntity).save(b);
  }

  findLoanAccount(caseId: string, manager?: EntityManager): Promise<LoanAccountEntity | null> {
    return (manager ?? this.cases.manager)
      .getRepository(LoanAccountEntity)
      .findOne({ where: { caseId } });
  }

  schedule(loanAccountId: string): Promise<ScheduleLineEntity[]> {
    return this.cases.manager
      .getRepository(ScheduleLineEntity)
      .find({ where: { loanAccountId }, order: { number: "ASC" } });
  }

  findDisbursement(loanAccountId: string): Promise<DisbursementEntity | null> {
    return this.cases.manager
      .getRepository(DisbursementEntity)
      .findOne({ where: { loanAccountId } });
  }

  async insertLoan(
    manager: EntityManager,
    account: Partial<LoanAccountEntity>,
    lines: Partial<ScheduleLineEntity>[],
    disbursement: Partial<DisbursementEntity>,
  ): Promise<LoanAccountEntity> {
    const accounts = manager.getRepository(LoanAccountEntity);
    const inserted = await accounts.insert(account);
    const loanAccountId = inserted.identifiers[0]?.id as string;
    await manager
      .getRepository(ScheduleLineEntity)
      .insert(lines.map((l) => ({ ...l, loanAccountId })));
    await manager.getRepository(DisbursementEntity).insert({ ...disbursement, loanAccountId });
    return (await accounts.findOne({ where: { id: loanAccountId } })) as LoanAccountEntity;
  }
}
