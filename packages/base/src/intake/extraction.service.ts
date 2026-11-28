import {
  DOCUMENT_EXTRACTION,
  type DocumentExtraction,
  type DocumentReading,
  isProviderUnavailable,
} from "@loan/contracts";
import {
  type CaseExtractionsView,
  DOCUMENT_TYPE_LABEL,
  type DocumentExtractionView,
  type DocumentType,
  EXTRACTION_FLAG_LABEL,
  ProblemCode,
  Role,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { ActivityService } from "../cases/activity.service";
import { canView } from "../cases/case-access";
import { CasesRepository } from "../cases/cases.repository";
import { CasesService } from "../cases/cases.service";
import {
  DomainError,
  forbiddenRole,
  invalidState,
  isUniqueViolation,
  notFound,
} from "../cases/domain-error";
import type { CaseDocumentEntity } from "../cases/entities/case-document.entity";
import type { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { TransactionRunner } from "../database/transaction-runner";
import type { DocumentExtractionEntity } from "./intake.entities";
import { IntakeRepository } from "./intake.repository";
import { failureWords } from "./intake.service";
import { documentFlags, extractRefusal, mismatchTolerance } from "./intake-rules";

/** One reading per document upload (migration 1764300004000). */
export const ONE_READING_INDEX = "UQ_document_extraction_upload";

/**
 * OCR and bank statement analysis on a case's received documents (PRD DOC-002, DOC-007). The
 * loan officer runs it on a document the borrower uploaded; the (simulated) provider reads the
 * figures it shows, they are compared with the application, and the reading is stored
 * insert-only with its flags and an activity event, in one transaction. It informs the
 * officer's verification and recommendation; it never changes the decision or the case's
 * status. When OCR is unavailable nothing is written and the officer verifies the document by
 * eye, as before.
 */
@Injectable()
export class ExtractionService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: IntakeRepository,
    private readonly casesRepo: CasesRepository,
    private readonly cases: CasesService,
    private readonly activity: ActivityService,
    @Inject(DOCUMENT_EXTRACTION) private readonly ocr: DocumentExtraction,
  ) {}

  async forCase(user: SessionUser, caseId: string): Promise<CaseExtractionsView> {
    const c = await this.cases.visible(user, caseId);
    const docs = await this.repo.documents(c.id);
    const readings = await this.repo.extractions(c.id);
    const names = await this.repo.staffNames(readings.map((r) => r.extractedBy));
    return {
      caseId: c.id,
      lines: docs.map((doc) => {
        const reading = readings.find(
          (r) => r.caseDocumentId === doc.id && r.attempt === doc.attempt,
        );
        const refusal = extractRefusal(c.status, doc, reading !== undefined);
        return {
          documentType: doc.documentType,
          documentStatus: doc.status,
          attempt: doc.attempt,
          uploadReference: doc.uploadReference,
          extraction: reading ? view(reading, names) : null,
          extract:
            user.role === Role.LoanOfficer ? { enabled: refusal === null, detail: refusal } : null,
        };
      }),
    };
  }

  /**
   * Read one received document with OCR. The provider is called outside the transaction with
   * one key per upload (a retry gets the same reading); the case, the document and "not read
   * yet" are checked again under the case's row lock before anything is written.
   */
  async extract(
    user: SessionUser,
    caseId: string,
    type: DocumentType,
  ): Promise<CaseExtractionsView> {
    if (user.role !== Role.LoanOfficer) {
      throw forbiddenRole("Only a loan officer can read documents with OCR.");
    }
    const before = await this.cases.visible(user, caseId);
    const doc = await this.readable(before, type);
    let reading: DocumentReading;
    try {
      reading = await this.ocr.readDocument({
        idempotencyKey: `ocr-${doc.id}-a${doc.attempt}`,
        applicantId: before.applicantId,
        documentType: type,
        uploadReference: doc.uploadReference as string,
      });
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      throw new DomainError(
        503,
        ProblemCode.ProviderUnavailable,
        `OCR ${failureWords(err)}. Nothing was recorded: verify the document by eye, or try again.`,
      );
    }

    await this.tx
      .run(async (m) => {
        const c = await this.lock(m, user, caseId);
        const current = await this.readable(c, type, m);
        if (current.attempt !== doc.attempt || current.uploadReference !== doc.uploadReference) {
          throw invalidState("The document was requested again meanwhile. Reload the case.");
        }
        const a = c.applicant;
        const application = {
          monthlyIncome: a.declaredMonthlyIncome ?? a.monthlyIncome,
          monthlyObligations: a.monthlyObligations,
          employer: a.employer,
        };
        const s = reading.statement;
        const flags = documentFlags(
          {
            monthlyIncome: reading.monthlyIncome,
            employer: reading.employer,
            recurringObligations: s?.recurringObligations ?? null,
          },
          application,
          mismatchTolerance(),
        );
        await this.repo.insertExtraction(m, {
          caseId: c.id,
          caseDocumentId: current.id,
          documentType: type,
          attempt: current.attempt,
          uploadReference: current.uploadReference as string,
          reference: reading.reference,
          providerMode: reading.mode,
          monthlyIncome: reading.monthlyIncome,
          employer: reading.employer,
          salaryCredit: s?.salaryCredit ?? null,
          monthsWithSalary: s?.monthsWithSalary ?? null,
          monthsCovered: s?.monthsCovered ?? null,
          recurringObligations: s?.recurringObligations ?? null,
          averageDailyBalance: s?.averageDailyBalance ?? null,
          returnedItems: s?.returnedItems ?? null,
          riskyMerchants: s?.riskyMerchants ?? null,
          comparedMonthlyIncome: application.monthlyIncome,
          comparedMonthlyObligations: application.monthlyObligations,
          comparedEmployer: application.employer,
          flags,
          extractedBy: user.id,
        });
        const found = reading.monthlyIncome
          ? `income ₱${reading.monthlyIncome.toString()} a month`
          : "no income figure";
        const obligations = s
          ? `, recurring obligations ₱${s.recurringObligations.toString()} a month`
          : "";
        const flagged = flags.length
          ? `Flagged: ${flags.map((f) => EXTRACTION_FLAG_LABEL[f]).join("; ")}.`
          : "Nothing flagged.";
        await this.activity.record(m, {
          caseId: c.id,
          actor: user,
          action: "DOCUMENT_EXTRACTED",
          summary: `Read ${DOCUMENT_TYPE_LABEL[type]} with OCR (simulated, ${reading.reference}): ${found}${obligations}. ${flagged}`,
          details: {
            documentType: type,
            reference: reading.reference,
            uploadReference: current.uploadReference,
            attempt: current.attempt,
            flags,
          },
        });
      })
      .catch((err: unknown) => {
        // The backstop for two readings of one upload: the unique index refused the second.
        // Mapped after the transaction rolled back.
        if (isUniqueViolation(err, ONE_READING_INDEX)) {
          throw invalidState(`${DOCUMENT_TYPE_LABEL[type]} has already been read with OCR.`);
        }
        throw err;
      });
    return this.forCase(user, caseId);
  }

  /** The document if OCR may read it now (called again under the lock inside the transaction). */
  private async readable(
    c: LoanCaseEntity,
    type: DocumentType,
    m?: EntityManager,
  ): Promise<CaseDocumentEntity> {
    const doc = (await this.repo.documents(c.id, m)).find((d) => d.documentType === type);
    if (!doc) throw invalidState(`${DOCUMENT_TYPE_LABEL[type]} was not requested on this case.`);
    const read = (await this.repo.extractions(c.id, m)).some(
      (r) => r.caseDocumentId === doc.id && r.attempt === doc.attempt,
    );
    const refusal = extractRefusal(c.status, doc, read);
    if (refusal) throw invalidState(refusal);
    return doc;
  }

  private async lock(m: EntityManager, user: SessionUser, id: string): Promise<LoanCaseEntity> {
    const c = await this.casesRepo.lockCase(m, id);
    if (!c || !canView(user, c)) throw notFound();
    return c;
  }
}

function view(r: DocumentExtractionEntity, names: Map<string, string>): DocumentExtractionView {
  return {
    reference: r.reference,
    documentType: r.documentType,
    attempt: r.attempt,
    uploadReference: r.uploadReference,
    providerMode: r.providerMode,
    monthlyIncome: r.monthlyIncome?.toString() ?? null,
    employer: r.employer,
    statement:
      r.salaryCredit && r.recurringObligations && r.averageDailyBalance
        ? {
            salaryCredit: r.salaryCredit.toString(),
            monthsWithSalary: r.monthsWithSalary ?? 0,
            monthsCovered: r.monthsCovered ?? 0,
            recurringObligations: r.recurringObligations.toString(),
            averageDailyBalance: r.averageDailyBalance.toString(),
            returnedItems: r.returnedItems ?? 0,
            riskyMerchants: r.riskyMerchants ?? false,
          }
        : null,
    compared: {
      monthlyIncome: r.comparedMonthlyIncome.toString(),
      monthlyObligations: r.comparedMonthlyObligations.toString(),
      employer: r.comparedEmployer,
    },
    flags: r.flags,
    extractedByName: names.get(r.extractedBy) ?? r.extractedBy,
    extractedAt: r.extractedAt.toISOString(),
  };
}
