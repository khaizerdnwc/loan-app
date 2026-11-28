import { IntakeDraftStatus } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager, In } from "typeorm";
import { StaffEntity } from "../auth/staff.entity";
import { ApplicantEntity } from "../cases/entities/applicant.entity";
import { CaseDocumentEntity } from "../cases/entities/case-document.entity";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { DocumentExtractionEntity, IntakeBatchEntity, IntakeDraftEntity } from "./intake.entities";
import { normaliseName } from "./intake-rules";

export interface Identity {
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
}

export type IdentityMatch =
  | { kind: "none" }
  | { kind: "one"; applicant: ApplicantEntity }
  | { kind: "many" };

/** The first key of the two-key advisory lock on an applicant identity (its own key space). */
const IDENTITY_LOCK_SPACE = 4004;

/** Storage for intake batches, drafts and document readings (house/no-datasource-outside-repository). */
@Injectable()
export class IntakeRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private m(manager?: EntityManager): EntityManager {
    return manager ?? this.ds.manager;
  }

  // --- intake --------------------------------------------------------------------------------

  /**
   * The customers on record with this name, birth date and ID ending: none, exactly one, or
   * several (an ambiguity a person must resolve; never read as "not on record").
   */
  async matchApplicant(identity: Identity, manager?: EntityManager): Promise<IdentityMatch> {
    const candidates = await this.m(manager)
      .getRepository(ApplicantEntity)
      .find({
        where: { birthDate: identity.birthDate, governmentIdLast4: identity.governmentIdLast4 },
        order: { id: "ASC" },
        take: 20,
      });
    const name = normaliseName(identity.fullName);
    const hits = candidates.filter((a) => normaliseName(a.fullName) === name);
    if (hits.length === 0) return { kind: "none" };
    if (hits.length > 1) return { kind: "many" };
    return { kind: "one", applicant: hits[0] as ApplicantEntity };
  }

  /**
   * Serialise captures of one identity for the rest of the transaction: a transaction-scoped
   * advisory lock on (name as compared, birth date, ID ending), in its own key space. Taken before
   * the re-match, so two drafts for the same new person confirmed at once capture them once.
   */
  async lockIdentity(manager: EntityManager, identity: Identity): Promise<void> {
    const key = `${normaliseName(identity.fullName)}|${identity.birthDate}|${identity.governmentIdLast4}`;
    await manager.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      IDENTITY_LOCK_SPACE,
      key,
    ]);
  }

  pendingCount(fingerprint: string, manager?: EntityManager): Promise<number> {
    return this.m(manager)
      .getRepository(IntakeDraftEntity)
      .count({ where: { fingerprint, status: IntakeDraftStatus.PendingReview } });
  }

  insertBatch(
    manager: EntityManager,
    batch: Partial<IntakeBatchEntity>,
  ): Promise<IntakeBatchEntity> {
    const repo = manager.getRepository(IntakeBatchEntity);
    return repo.save(repo.create(batch));
  }

  saveDraft(manager: EntityManager, draft: IntakeDraftEntity): Promise<IntakeDraftEntity> {
    return manager.getRepository(IntakeDraftEntity).save(draft);
  }

  newDraft(manager: EntityManager): IntakeDraftEntity {
    return manager.getRepository(IntakeDraftEntity).create();
  }

  /**
   * Newest first (by upload, then row), at most 500. The filters go into the WHERE, before the
   * limit, so a filtered list (the pending queue) is never cut short by other drafts.
   */
  async drafts(
    filter: { ids?: string[]; status?: IntakeDraftStatus } = {},
  ): Promise<IntakeDraftEntity[]> {
    const q = this.ds
      .getRepository(IntakeDraftEntity)
      .createQueryBuilder("d")
      .leftJoinAndSelect("d.batch", "b");
    if (filter.ids) q.andWhere("d.id IN (:...ids)", { ids: filter.ids });
    if (filter.status) q.andWhere("d.status = :status", { status: filter.status });
    return q
      .orderBy("b.uploadedAt", "DESC")
      .addOrderBy("d.rowNumber", "ASC")
      .addOrderBy("d.id", "ASC")
      .take(500)
      .getMany();
  }

  async findDraft(id: string): Promise<IntakeDraftEntity | null> {
    return (await this.drafts({ ids: [id] }))[0] ?? null;
  }

  async lockDraft(manager: EntityManager, id: string): Promise<IntakeDraftEntity | null> {
    const draft = await manager
      .getRepository(IntakeDraftEntity)
      .createQueryBuilder("d")
      .setLock("pessimistic_write")
      .where("d.id = :id", { id })
      .getOne();
    if (!draft) return null;
    draft.batch = (await manager
      .getRepository(IntakeBatchEntity)
      .findOne({ where: { id: draft.batchId } })) as IntakeBatchEntity;
    return draft;
  }

  async staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map();
    const staff = await this.ds.getRepository(StaffEntity).find({ where: { id: In(wanted) } });
    return new Map(staff.map((s) => [s.id, s.fullName]));
  }

  async applicantNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map();
    const rows = await this.ds.getRepository(ApplicantEntity).find({ where: { id: In(wanted) } });
    return new Map(rows.map((a) => [a.id, a.fullName]));
  }

  async caseReferences(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map();
    const rows = await this.ds.getRepository(LoanCaseEntity).find({ where: { id: In(wanted) } });
    return new Map(rows.map((c) => [c.id, c.reference]));
  }

  // --- document readings ---------------------------------------------------------------------

  documents(caseId: string, manager?: EntityManager): Promise<CaseDocumentEntity[]> {
    return this.m(manager)
      .getRepository(CaseDocumentEntity)
      .find({ where: { caseId }, order: { requestedAt: "ASC", documentType: "ASC" } });
  }

  extractions(caseId: string, manager?: EntityManager): Promise<DocumentExtractionEntity[]> {
    return this.m(manager)
      .getRepository(DocumentExtractionEntity)
      .find({ where: { caseId }, order: { extractedAt: "ASC", id: "ASC" } });
  }

  insertExtraction(
    manager: EntityManager,
    row: Partial<DocumentExtractionEntity>,
  ): Promise<DocumentExtractionEntity> {
    const repo = manager.getRepository(DocumentExtractionEntity);
    return repo.save(repo.create(row));
  }
}
