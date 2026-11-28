import { CaseStatus, CLOSED_CASE_STATUSES, Role } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { type EntityManager, In, LessThanOrEqual, Not, type Repository } from "typeorm";
import type { SessionUser } from "../auth/session";
import {
  type Identity,
  type IdentityMatch,
  identityKey,
  normaliseName,
} from "./applicant-identity";
import { ActivityEventEntity } from "./entities/activity-event.entity";
import { ApplicantEntity } from "./entities/applicant.entity";
import {
  BookingRequestEntity,
  DisbursementEntity,
  LoanAccountEntity,
  ScheduleLineEntity,
} from "./entities/booking.entities";
import { CaseDocumentEntity } from "./entities/case-document.entity";
import { ConsentRecordEntity } from "./entities/consent-record.entity";
import { DecisionRecordEntity } from "./entities/decision-record.entity";
import { LoanCaseEntity } from "./entities/loan-case.entity";

/** The first key of the two-key advisory lock on an applicant identity (its own key space). */
const IDENTITY_LOCK_SPACE = 4004;

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

  /** The applicant captured from this core customer number, if any (PRD INT-002). */
  findApplicantByCustomerNumber(customerNumber: string): Promise<ApplicantEntity | null> {
    return this.applicants.findOne({ where: { customerNumber } });
  }

  /**
   * A new applicant: an INSERT, never save()'s upsert, so a row with an id already on file is
   * refused (23505) instead of overwriting the customer stored under it.
   */
  async insertApplicant(manager: EntityManager, a: ApplicantEntity): Promise<ApplicantEntity> {
    await manager.getRepository(ApplicantEntity).insert(a);
    return a;
  }

  /** Update an applicant already on record (a walk-in linked to core). */
  async updateApplicant(manager: EntityManager, a: ApplicantEntity): Promise<void> {
    await manager.getRepository(ApplicantEntity).update(
      { id: a.id },
      {
        customerNumber: a.customerNumber,
        depositAccount: a.depositAccount,
        relationshipMonths: a.relationshipMonths,
        monthlyIncome: a.monthlyIncome,
        declaredMonthlyIncome: a.declaredMonthlyIncome,
      },
    );
  }

  /**
   * The customers on record with this identity (name as compared, birth date, ID ending): none,
   * exactly one, or several (an ambiguity a person must resolve; never read as "not on record").
   */
  async matchApplicantIdentity(
    identity: Identity,
    manager?: EntityManager,
  ): Promise<IdentityMatch> {
    // Every customer with this birth date and ID ending (no cap: a capped list could hide a
    // match and read "several" or "one" as fewer); the name is then compared as everywhere.
    // No index: the applicant table is small (synthetic personas and captures); add one on
    // (birth_date, government_id_last4) when it is not.
    const candidates = await (manager?.getRepository(ApplicantEntity) ?? this.applicants).find({
      where: { birthDate: identity.birthDate, governmentIdLast4: identity.governmentIdLast4 },
      order: { id: "ASC" },
    });
    const name = normaliseName(identity.fullName);
    const hits = candidates.filter((a) => normaliseName(a.fullName) === name);
    if (hits.length === 0) return { kind: "none" };
    if (hits.length > 1) return { kind: "many", applicants: hits };
    return { kind: "one", applicant: hits[0] as ApplicantEntity };
  }

  /**
   * Serialise captures of one identity for the rest of the transaction: a transaction-scoped
   * advisory lock on the identity key, in its own key space (two-key form, apart from the
   * audit log's single-key lock). Taken before matching, so two captures of the same person at
   * once (walk-ins, intake drafts, or one of each) store them once.
   */
  async lockApplicantIdentity(manager: EntityManager, identity: Identity): Promise<void> {
    await manager.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      IDENTITY_LOCK_SPACE,
      identityKey(identity),
    ]);
  }

  /** How many open officer-stage cases (draft, review, information requested) each officer owns. */
  async openCasesByOwner(): Promise<Map<string, number>> {
    const rows: { owner_id: string; n: string }[] = await this.cases
      .createQueryBuilder("c")
      .select("c.owner_id", "owner_id")
      .addSelect("count(*)", "n")
      .where("c.owner_id IS NOT NULL")
      .andWhere("c.status IN (:...statuses)", {
        statuses: [CaseStatus.Draft, CaseStatus.Review, CaseStatus.InfoRequested],
      })
      .groupBy("c.owner_id")
      .getRawMany();
    return new Map(rows.map((r) => [r.owner_id, Number(r.n)]));
  }

  findCase(id: string): Promise<LoanCaseEntity | null> {
    return this.cases.findOne({ where: { id } });
  }

  /**
   * Load a case and lock its row until the transaction ends (SELECT … FOR NO KEY UPDATE). Two
   * requests acting on the same case are serialised here, so the second one sees the
   * first one's status — the basis of the booking guarantee (ADR 0020 R2). NO KEY UPDATE
   * conflicts with itself and with every UPDATE of the row exactly as FOR UPDATE does, but not
   * with the FOR KEY SHARE a foreign-key check takes: a child row written for this case on
   * another connection (a provider call) does not wait on this lock. A case's id never
   * changes, and every child written under the lock is written in this same transaction.
   */
  async lockCase(manager: EntityManager, id: string): Promise<LoanCaseEntity | null> {
    const locked = await manager
      .getRepository(LoanCaseEntity)
      .createQueryBuilder("c")
      .setLock("for_no_key_update")
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
          ? this.cases.find({
              where: {
                status: In([CaseStatus.Draft, CaseStatus.Review, CaseStatus.InfoRequested]),
              },
              order,
            })
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

  /**
   * Ids of drafts last changed by `draftsBefore` and offers made by `offersBefore`:
   * the expiry sweep's candidates. Each is locked and checked again before it is expired.
   */
  async findStale(
    draftsBefore: Date,
    offersBefore: Date,
  ): Promise<{ drafts: string[]; offers: string[] }> {
    const order = { updatedAt: "ASC" as const, id: "ASC" as const };
    const select = { id: true } as const;
    const [drafts, offers] = await Promise.all([
      this.cases.find({
        select,
        where: { status: CaseStatus.Draft, updatedAt: LessThanOrEqual(draftsBefore) },
        order,
      }),
      this.cases.find({
        select,
        where: { status: CaseStatus.Offer, offeredAt: LessThanOrEqual(offersBefore) },
        order,
      }),
    ]);
    return { drafts: drafts.map((c) => c.id), offers: offers.map((c) => c.id) };
  }

  /**
   * Write a case's routing (owner, priority) without touching `updated_at`: that column is the
   * draft-expiry clock and the queue's waiting time, which routing must not move. The version
   * is still bumped, so anyone holding the old row sees the change.
   */
  async saveRouting(manager: EntityManager, c: LoanCaseEntity): Promise<void> {
    await manager.query(
      `UPDATE "loan_case" SET "owner_id" = $2, "priority" = $3, "version" = "version" + 1 WHERE "id" = $1`,
      [c.id, c.ownerId, c.priority],
    );
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

  findDecision(id: string, manager?: EntityManager): Promise<DecisionRecordEntity | null> {
    return (manager ?? this.cases.manager)
      .getRepository(DecisionRecordEntity)
      .findOne({ where: { id } });
  }

  // --- history -----------------------------------------------------------------------------

  /** The applicant's open application for the product (not in a closed status), if any. */
  /** Every open (not closed) case of an applicant, oldest first. */
  openCasesOfApplicant(applicantId: string, manager: EntityManager): Promise<LoanCaseEntity[]> {
    return manager.getRepository(LoanCaseEntity).find({
      where: { applicantId, status: Not(In([...CLOSED_CASE_STATUSES])) },
      order: { createdAt: "ASC", id: "ASC" },
    });
  }

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

  /** The case's latest event of one kind (e.g. WITHDRAWN: who withdrew it, and when). */
  lastEvent(caseId: string, action: string): Promise<ActivityEventEntity | null> {
    return this.cases.manager
      .getRepository(ActivityEventEntity)
      .findOne({ where: { caseId, action }, order: { createdAt: "DESC", id: "DESC" } });
  }

  activity(caseId: string): Promise<ActivityEventEntity[]> {
    return this.cases.manager
      .getRepository(ActivityEventEntity)
      .find({ where: { caseId }, order: { createdAt: "ASC" } });
  }

  // --- document checklist (one row per case and document type) ----------------------------

  documents(caseId: string, manager?: EntityManager): Promise<CaseDocumentEntity[]> {
    return (manager ?? this.cases.manager)
      .getRepository(CaseDocumentEntity)
      .find({ where: { caseId }, order: { requestedAt: "ASC", documentType: "ASC" } });
  }

  saveDocument(manager: EntityManager, doc: CaseDocumentEntity): Promise<CaseDocumentEntity> {
    return manager.getRepository(CaseDocumentEntity).save(doc);
  }

  newDocument(manager: EntityManager): CaseDocumentEntity {
    return manager.getRepository(CaseDocumentEntity).create();
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
