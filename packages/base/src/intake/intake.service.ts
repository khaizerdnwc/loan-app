import { randomUUID } from "node:crypto";
import {
  DOCUMENT_EXTRACTION,
  type DocumentExtraction,
  type ExtractedBundle,
  isProviderUnavailable,
  type ProviderUnavailableError,
} from "@loan/contracts";
import {
  Channel,
  type ConfirmIntakeDraftRequest,
  type DiscardIntakeDraftRequest,
  type FieldError,
  INTAKE_SAMPLE_FILES,
  INTAKE_SOURCE_LABEL,
  IntakeDraftStatus,
  type IntakeDraftView,
  IntakeSource,
  type IntakeUploadView,
  Money,
  type NewApplicantRequest,
  type NewCustomerFromDraft,
  ProblemCode,
  Role,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { ActivityService } from "../cases/activity.service";
import { ApplicantsService, CUSTOMER_NUMBER_INDEX } from "../cases/applicants.service";
import { CasesRepository } from "../cases/cases.repository";
import { CasesService, duplicateApplication, OPEN_APPLICATION_INDEX } from "../cases/cases.service";
import {
  DomainError,
  forbiddenRole,
  invalidState,
  isUniqueViolation,
  notFound,
  validation,
} from "../cases/domain-error";
import type { ApplicantEntity } from "../cases/entities/applicant.entity";
import { PERSONAL_LOAN, termErrors } from "../cases/product";
import { TransactionRunner } from "../database/transaction-runner";
import type { IntakeDraftEntity } from "./intake.entities";
import { IntakeRepository } from "./intake.repository";
import { draftActions, idDigits, mismatchTolerance, normaliseName, rowFlags } from "./intake-rules";

/** The partial unique index that keeps one pending draft per file row (migration 1764300004000). */
export const PENDING_ROW_INDEX = "UQ_intake_draft_pending_row";

/** One batch per OCR reading reference (migration 1764300004000). */
export const BATCH_REFERENCE_INDEX = "UQ_intake_batch_reference";

/**
 * Email and file intake (PRD INT-010, F4). A loan officer uploads an emailed bundle or a
 * partner's spreadsheet (synthetic files; the upload is simulated); OCR (the DocumentExtraction
 * port, simulated) reads it into rows, and each row becomes a draft waiting for review — never
 * an application. The officer checks each draft, completes what OCR could not read, and
 * confirms it into an ordinary case draft (then consent and submit as for any application) or
 * discards it. When OCR is unavailable nothing is written and the officer captures the
 * application by hand. Every change is one transaction with its audit entry, and a confirmed
 * draft writes its case's activity events in that same transaction.
 */
@Injectable()
export class IntakeService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: IntakeRepository,
    private readonly cases: CasesService,
    private readonly casesRepo: CasesRepository,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly applicants: ApplicantsService,
    @Inject(DOCUMENT_EXTRACTION) private readonly ocr: DocumentExtraction,
  ) {}

  async list(user: SessionUser, view: "pending" | "all"): Promise<IntakeDraftView[]> {
    this.readerOnly(user);
    // Filtered in the query, before its limit, so no waiting draft falls off the queue.
    const drafts = await this.repo.drafts(
      view === "pending" ? { status: IntakeDraftStatus.PendingReview } : {},
    );
    return this.views(user, drafts);
  }

  async get(user: SessionUser, id: string): Promise<IntakeDraftView> {
    this.readerOnly(user);
    const draft = await this.repo.findDraft(id);
    if (!draft) throw notFound("intake draft");
    return (await this.views(user, [draft]))[0] as IntakeDraftView;
  }

  /**
   * Read an uploaded file into drafts. The provider is called before the transaction with a
   * new key; the duplicate check runs inside it (and the partial unique index holds it under
   * a race), so the same file is never waiting for review twice.
   */
  async upload(
    user: SessionUser,
    source: IntakeSource,
    sampleFile?: string,
  ): Promise<IntakeUploadView> {
    this.officerOnly(user);
    if (
      sampleFile !== undefined &&
      !INTAKE_SAMPLE_FILES.some((f) => f.key === sampleFile && f.source === source)
    ) {
      throw validation("Choose one of the synthetic files for this source.", [
        { field: "sampleFile", message: "Choose one of the synthetic files for this source." },
      ]);
    }
    let bundle: ExtractedBundle;
    try {
      bundle = await this.ocr.extractBundle({ idempotencyKey: randomUUID(), source, sampleFile });
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      throw new DomainError(
        503,
        ProblemCode.ProviderUnavailable,
        `OCR ${failureWords(err)}. Nothing was recorded: try again, or capture the application by hand in New application.`,
      );
    }
    const tolerance = mismatchTolerance();
    const ids = await this.tx
      .run(async (m) => {
        const waiting = await this.repo.pendingCount(bundle.fingerprint, m);
        if (waiting > 0) throw alreadyWaiting(bundle.fileName, waiting);
        const batch = await this.repo.insertBatch(m, {
          reference: bundle.reference,
          source,
          fileName: bundle.fileName,
          fingerprint: bundle.fingerprint,
          rowCount: bundle.rows.length,
          providerMode: bundle.mode,
          uploadedBy: user.id,
        });
        const created: string[] = [];
        for (const row of bundle.rows) {
          const match =
            row.fullName && row.birthDate && row.governmentIdLast4
              ? await this.repo.matchApplicant(
                  {
                    fullName: row.fullName,
                    birthDate: row.birthDate,
                    governmentIdLast4: row.governmentIdLast4,
                  },
                  m,
                )
              : ({ kind: "none" } as const);
          const d = this.repo.newDraft(m);
          Object.assign(d, {
            batchId: batch.id,
            fingerprint: bundle.fingerprint,
            rowNumber: row.rowNumber,
            sourceDetail: row.sourceDetail,
            fullName: row.fullName,
            birthDate: row.birthDate,
            governmentIdLast4: row.governmentIdLast4,
            employer: row.employer,
            declaredMonthlyIncome: row.declaredMonthlyIncome,
            documentMonthlyIncome: row.documentMonthlyIncome,
            amount: row.amount,
            tenorMonths: row.tenorMonths,
            purpose: row.purpose,
            matchedApplicantId: match.kind === "one" ? match.applicant.id : null,
            flags: rowFlags(row, match.kind, tolerance),
            providerMode: bundle.mode,
            status: IntakeDraftStatus.PendingReview,
            caseId: null,
            reviewedBy: null,
            reviewedAt: null,
            discardReason: null,
          });
          created.push((await this.repo.saveDraft(m, d)).id);
        }
        await this.audit.append(m, {
          actor: user,
          action: "INTAKE_UPLOADED",
          summary: `Uploaded ${INTAKE_SOURCE_LABEL[source].toLowerCase()} ${bundle.reference}: OCR extracted ${bundle.rows.length} draft${bundle.rows.length === 1 ? "" : "s"} for review (simulated).`,
          details: { reference: bundle.reference, source, rows: bundle.rows.length },
        });
        return created;
      })
      .catch((err: unknown) => {
        // Two uploads of the same file at once: the index refused the second one's rows.
        // Mapped after the transaction rolled back.
        if (isUniqueViolation(err, PENDING_ROW_INDEX)) throw alreadyWaiting(bundle.fileName, 1);
        if (isUniqueViolation(err, BATCH_REFERENCE_INDEX)) {
          throw new DomainError(
            409,
            ProblemCode.Conflict,
            "OCR returned a reference that is already on file. Nothing was recorded: upload the file again.",
          );
        }
        throw err;
      });
    const drafts = await this.views(user, await this.repo.drafts({ ids }));
    return {
      reference: bundle.reference,
      source,
      fileName: bundle.fileName,
      rowCount: drafts.length,
      flaggedCount: drafts.filter((d) => d.flags.length > 0).length,
      providerMode: bundle.mode,
      drafts,
    };
  }

  /**
   * The loan officer confirms a reviewed draft into a case draft (never a submitted
   * application). The customer is matched again, under the draft's lock, with the ID the
   * officer completed; the terms are checked against the product; INT-007 applies as for any
   * capture.
   */
  async confirm(
    user: SessionUser,
    id: string,
    body: ConfirmIntakeDraftRequest,
  ): Promise<IntakeDraftView> {
    this.officerOnly(user);
    const amount = parseAmount(body.amount);
    const errors: FieldError[] = termErrors(amount, body.tenorMonths);
    const purpose = body.purpose?.trim() ?? "";
    if (!purpose) errors.push({ field: "purpose", message: "Enter the purpose of the loan." });
    const typedId = body.governmentIdLast4?.trim() || null;
    if (typedId !== null && !/^\d{4}$/.test(typedId)) {
      errors.push({ field: "governmentIdLast4", message: "Enter the last 4 digits of the ID." });
    }
    if (errors.length || !amount) throw validation("Check the highlighted fields.", errors);

    // A customer to capture from the draft is built before the transaction: building may ask
    // core banking (no provider call inside a transaction). Under the lock the draft is matched
    // again first, so a customer captured meanwhile is used rather than captured twice.
    const toCapture = body.newCustomer ? await this.customerFromDraft(id, typedId, body) : null;

    let applicantName = "";
    let applicantId: string | null = null;
    await this.tx
      .run(async (m) => {
        const draft = await this.repo.lockDraft(m, id);
        if (!draft) throw notFound("intake draft");
        if (draft.status !== IntakeDraftStatus.PendingReview) {
          throw invalidState("This draft has already been reviewed. Reload the list.");
        }
        // Checked again under the lock: OCR's digits stand; the officer's only fill a gap.
        const ids = idDigits(draft.governmentIdLast4, typedId);
        if (ids.error) throw validation("Check the government ID.", [ids.error]);
        const last4 = ids.digits;
        if (!last4) {
          throw validation("Complete the government ID.", [
            {
              field: "governmentIdLast4",
              message: "OCR could not read the ID number: enter its last 4 digits.",
            },
          ]);
        }
        if (!draft.fullName || !draft.birthDate) {
          throw validation("The file has no name or birth date for this row.", [
            {
              field: "newCustomer",
              message:
                "OCR could not read the name or birth date, so no customer can be matched or captured: discard the draft and capture the application by hand.",
            },
          ]);
        }
        const identity = {
          fullName: draft.fullName,
          birthDate: draft.birthDate,
          governmentIdLast4: last4,
        };
        // One capture per identity at a time, then match again: a customer captured meanwhile
        // (by hand, or by another draft for the same person) is used, never captured twice.
        await this.repo.lockIdentity(m, identity);
        const match = await this.repo.matchApplicant(identity, m);
        if (match.kind === "many") throw severalMatch();
        let applicant = match.kind === "one" ? match.applicant : null;
        if (!applicant && toCapture) {
          if (!sameIdentity(toCapture, identity)) {
            throw invalidState("The draft changed meanwhile. Reload the list.");
          }
          await this.applicants.insertApplicant(m, user, toCapture);
          applicant = toCapture;
        }
        if (!applicant) {
          throw validation(
            "No customer record matches this draft.",
            typedId !== null
              ? [
                  {
                    field: "governmentIdLast4",
                    message:
                      "No customer on record has this name, birth date and ID ending. Check the last 4 digits; if they are right, capture the customer with New or walk-in customer.",
                  },
                ]
              : [
                  {
                    field: "newCustomer",
                    message:
                      "No customer on record matches this draft. Capture them from it: enter their months with the employer and monthly obligations (and their core customer number if they already bank with WhiteBank).",
                  },
                ],
          );
        }
        const captured = applicant === toCapture;
        applicantName = applicant.fullName;
        applicantId = applicant.id;
        const c = await this.cases.captureDraft(
          m,
          user,
          applicant,
          { amount, tenorMonths: body.tenorMonths, purpose },
          Channel.FileIntake,
        );
        const before = {
          amount: draft.amount?.toString() ?? null,
          tenorMonths: draft.tenorMonths,
          purpose: draft.purpose,
          governmentIdLast4: draft.governmentIdLast4,
        };
        const after = {
          amount: amount.toString(),
          tenorMonths: body.tenorMonths,
          purpose,
          governmentIdLast4: last4,
        };
        draft.status = IntakeDraftStatus.Confirmed;
        draft.caseId = c.id;
        draft.matchedApplicantId = applicant.id;
        draft.applicantCaptured = captured;
        draft.reviewedBy = user.id;
        draft.reviewedAt = new Date();
        await this.repo.saveDraft(m, draft);
        await this.activity.record(m, {
          caseId: c.id,
          actor: user,
          action: "INTAKE_CONFIRMED",
          summary: `Captured from intake batch ${draft.batch?.reference ?? "(no reference)"} (${draft.sourceDetail}) after review of the OCR draft (simulated).`,
          details: {
            intakeDraftId: draft.id,
            batchReference: draft.batch?.reference ?? null,
            sourceDetail: draft.sourceDetail,
            flags: draft.flags,
            applicantCaptured: captured,
            before,
            after,
          },
          // The audit log is never redacted: it keeps the terms, not the ID digits.
          auditOnly: {
            details: {
              before: withoutId(before),
              after: withoutId(after),
            },
          },
        });
      })
      .catch(async (err: unknown) => {
        // Both mapped after the transaction rolled back, so the lookup holds no second connection.
        // The core customer was captured as an applicant meanwhile (one per core customer).
        if (toCapture && isUniqueViolation(err, CUSTOMER_NUMBER_INDEX)) {
          throw await this.applicants.alreadyOnFile(toCapture);
        }
        // A capture for the same applicant committed meanwhile: the INT-007 index refused this one.
        if (!isUniqueViolation(err, OPEN_APPLICATION_INDEX) || !applicantId) throw err;
        const open = await this.casesRepo.findOpenCase(applicantId, PERSONAL_LOAN.code);
        throw duplicateApplication(applicantName, open?.reference ?? "another case");
      });
    return this.get(user, id);
  }

  /**
   * The applicant to capture from a draft no customer matches: the draft's name, birth date, ID
   * (the officer's digits when the file had none), employer and declared income, with what the
   * officer adds. With a core customer number, core supplies identity, account and verified
   * income, and it must be the draft's person. Built before the transaction (it may call core);
   * validated, never written here. Null when a customer on record already matches the draft.
   */
  private async customerFromDraft(
    id: string,
    typedId: string | null,
    body: ConfirmIntakeDraftRequest,
  ): Promise<ApplicantEntity | null> {
    const extra = body.newCustomer as NewCustomerFromDraft;
    const draft = await this.repo.findDraft(id);
    if (!draft) throw notFound("intake draft");
    if (draft.status !== IntakeDraftStatus.PendingReview) {
      throw invalidState("This draft has already been reviewed. Reload the list.");
    }
    // Before any core call: OCR's digits stand; the officer's only fill a gap.
    const ids = idDigits(draft.governmentIdLast4, typedId);
    if (ids.error) throw validation("Check the government ID.", [ids.error]);
    const last4 = ids.digits;
    if (!draft.fullName || !draft.birthDate || !last4) return null;
    const identity = {
      fullName: draft.fullName,
      birthDate: draft.birthDate,
      governmentIdLast4: last4,
    };
    const match = await this.repo.matchApplicant(identity);
    if (match.kind === "many") throw severalMatch();
    if (match.kind === "one") return null;
    if (!draft.employer || !draft.declaredMonthlyIncome) {
      throw validation("The file is missing what a new customer needs.", [
        {
          field: "newCustomer",
          message:
            "The file has no employer or declared income, so the customer cannot be captured from it: capture them with New or walk-in customer instead.",
        },
      ]);
    }
    const request: NewApplicantRequest = {
      ...(extra.customerNumber?.trim() ? { customerNumber: extra.customerNumber.trim() } : {}),
      ...identity,
      employer: draft.employer,
      employmentMonths: extra.employmentMonths,
      monthlyIncome: draft.declaredMonthlyIncome.toString(),
      monthlyObligations: extra.monthlyObligations,
    };
    let a: ApplicantEntity;
    try {
      a = await this.applicants.buildApplicant(request);
    } catch (err) {
      // Its field errors name the new customer's own fields, as the dialog shows them.
      if (err instanceof DomainError && err.errors) {
        throw new DomainError(
          err.status,
          err.code,
          err.detail,
          err.errors.map((e) => ({ ...e, field: NEW_CUSTOMER_FIELD[e.field] ?? e.field })),
        );
      }
      throw err;
    }
    if (!sameIdentity(a, identity)) {
      throw validation("That core customer is not the person in this draft.", [
        {
          field: "newCustomer.customerNumber",
          message:
            "Core banking's customer with this number has another name, birth date or ID than the draft. Check the number, or leave it empty for a customer new to the bank.",
        },
      ]);
    }
    return a;
  }

  async discard(
    user: SessionUser,
    id: string,
    body: DiscardIntakeDraftRequest,
  ): Promise<IntakeDraftView> {
    this.officerOnly(user);
    const reason = body.reason?.trim() ?? "";
    if (!reason) {
      throw validation("Say why the draft is discarded.", [
        { field: "reason", message: "Enter why this draft is not taken forward." },
      ]);
    }
    await this.tx.run(async (m) => {
      const draft = await this.repo.lockDraft(m, id);
      if (!draft) throw notFound("intake draft");
      if (draft.status !== IntakeDraftStatus.PendingReview) {
        throw invalidState("This draft has already been reviewed. Reload the list.");
      }
      draft.status = IntakeDraftStatus.Discarded;
      draft.reviewedBy = user.id;
      draft.reviewedAt = new Date();
      draft.discardReason = reason;
      await this.repo.saveDraft(m, draft);
      await this.audit.append(m, {
        actor: user,
        action: "INTAKE_DRAFT_DISCARDED",
        summary: `Discarded the OCR draft from intake batch ${draft.batch?.reference ?? "(no reference)"} (${draft.sourceDetail}), with a reason.`,
        details: {
          intakeDraftId: draft.id,
          batchReference: draft.batch?.reference ?? null,
          before: { status: IntakeDraftStatus.PendingReview },
          // The reason is staff free text that may name the applicant: it stays on the draft.
          after: { status: IntakeDraftStatus.Discarded, reasonGiven: true },
        },
      });
    });
    return this.get(user, id);
  }

  private async views(user: SessionUser, drafts: IntakeDraftEntity[]): Promise<IntakeDraftView[]> {
    const staff = await this.repo.staffNames(
      drafts.flatMap((d) => [d.batch?.uploadedBy ?? null, d.reviewedBy]),
    );
    const applicants = await this.repo.applicantNames(drafts.map((d) => d.matchedApplicantId));
    const refs = await this.repo.caseReferences(drafts.map((d) => d.caseId));
    return drafts.map((d) => ({
      id: d.id,
      batchReference: d.batch?.reference ?? "",
      source: d.batch?.source ?? IntakeSource.EmailBundle,
      fileName: d.batch?.fileName ?? "",
      rowNumber: d.rowNumber,
      sourceDetail: d.sourceDetail,
      extracted: {
        fullName: d.fullName,
        birthDate: d.birthDate,
        governmentIdLast4: d.governmentIdLast4,
        employer: d.employer,
        declaredMonthlyIncome: d.declaredMonthlyIncome?.toString() ?? null,
        documentMonthlyIncome: d.documentMonthlyIncome?.toString() ?? null,
        amount: d.amount?.toString() ?? null,
        tenorMonths: d.tenorMonths,
        purpose: d.purpose,
      },
      matchedApplicant: d.matchedApplicantId
        ? { id: d.matchedApplicantId, fullName: applicants.get(d.matchedApplicantId) ?? "" }
        : null,
      flags: d.flags,
      status: d.status,
      providerMode: d.providerMode,
      uploadedByName: staff.get(d.batch?.uploadedBy ?? "") ?? "",
      uploadedAt: (d.batch?.uploadedAt ?? new Date(0)).toISOString(),
      case: d.caseId ? { id: d.caseId, reference: refs.get(d.caseId) ?? "" } : null,
      applicantCaptured: d.applicantCaptured,
      review:
        d.reviewedBy && d.reviewedAt
          ? {
              byName: staff.get(d.reviewedBy) ?? d.reviewedBy,
              at: d.reviewedAt.toISOString(),
              discardReason: d.discardReason,
            }
          : null,
      actions: draftActions(user.role, d.status, d.flags),
    }));
  }

  private readerOnly(user: SessionUser): void {
    if (user.role !== Role.LoanOfficer && user.role !== Role.Compliance) {
      throw forbiddenRole("Only a loan officer or Compliance can read intake drafts.");
    }
  }

  private officerOnly(user: SessionUser): void {
    if (user.role !== Role.LoanOfficer) {
      throw forbiddenRole("Only a loan officer can upload, confirm or discard intake drafts.");
    }
  }
}

/** A provider failure in words for the person at the screen. */
export function failureWords(err: ProviderUnavailableError): string {
  return err.failure === "TIMEOUT"
    ? "did not answer in time"
    : err.failure === "MALFORMED"
      ? "sent a reply that could not be read"
      : "is unavailable";
}

/** Terms without the government ID's digits, for the audit copy. */
function withoutId<T extends { governmentIdLast4: string | null }>(
  terms: T,
): Omit<T, "governmentIdLast4"> {
  const { governmentIdLast4: _id, ...rest } = terms;
  return rest;
}

/** The walk-in capture's fields the officer types on the draft, named as the request names them. */
const NEW_CUSTOMER_FIELD: Record<string, string> = {
  employmentMonths: "newCustomer.employmentMonths",
  monthlyObligations: "newCustomer.monthlyObligations",
  customerNumber: "newCustomer.customerNumber",
};

/** The same person: name (as compared everywhere in intake), birth date and ID ending. */
function sameIdentity(
  a: { fullName: string; birthDate: string; governmentIdLast4: string },
  b: { fullName: string; birthDate: string; governmentIdLast4: string },
): boolean {
  return (
    normaliseName(a.fullName) === normaliseName(b.fullName) &&
    a.birthDate === b.birthDate &&
    a.governmentIdLast4 === b.governmentIdLast4
  );
}

function severalMatch(): DomainError {
  return new DomainError(
    409,
    ProblemCode.Conflict,
    "Several customer records match this draft's name, birth date and ID ending, so it cannot be confirmed. Nothing was recorded: discard the draft and start the application from the right customer under New application.",
  );
}

function alreadyWaiting(fileName: string, count: number): DomainError {
  return new DomainError(
    409,
    ProblemCode.Conflict,
    `The drafts from "${fileName}" are already waiting for review (${count}). Review or discard them before uploading the file again.`,
  );
}

function parseAmount(raw: string | undefined): Money | null {
  if (raw === undefined || raw === null || raw === "") return null;
  try {
    return Money.of(String(raw));
  } catch {
    return null;
  }
}
