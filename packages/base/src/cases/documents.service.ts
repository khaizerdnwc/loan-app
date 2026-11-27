import {
  DOCUMENT_INTAKE,
  type DocumentIntake,
  isProviderUnavailable,
  type ReceivedDocument,
} from "@loan/contracts";
import {
  type CaseDetail,
  CaseStatus,
  DOCUMENT_TYPE_LABEL,
  type DocumentReviewRequest,
  DocumentStatus,
  DocumentType,
  type FieldError,
  type InfoRequestRequest,
  ProblemCode,
  Role,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { TransactionRunner } from "../database/transaction-runner";
import { ActivityService } from "./activity.service";
import { canView } from "./case-access";
import { CasesRepository } from "./cases.repository";
import { CasesService } from "./cases.service";
import { requestableTypes, requestRefusal } from "./documents";
import { DomainError, forbiddenRole, invalidState, notFound, validation } from "./domain-error";
import type { CaseDocumentEntity } from "./entities/case-document.entity";
import type { LoanCaseEntity } from "./entities/loan-case.entity";
import { assertTransition, InvalidTransitionError, moveTo } from "./lifecycle";
import { businessDate, expiresAt } from "./product";

const DUE_IN_DAYS: readonly number[] = [3, 5];

/**
 * Requests for information and the document checklist (PRD WF-007, DOC-003; DOC-001 simulated).
 *
 * The loan officer asks the borrower for documents on a referred case (REVIEW →
 * INFO_REQUESTED). The borrower's upload is simulated through the DocumentIntake port; when
 * the last requested document arrives the case goes back to REVIEW. The officer then verifies
 * or rejects each received document, and must do so before recommending. Every change: lock
 * the case, check the state (again, under the lock), change it, write the activity event — one
 * transaction. Requests for the same case are serialised by the lock, so the unique
 * (case, document type) index is never the thing that refuses.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CasesRepository,
    private readonly activity: ActivityService,
    private readonly cases: CasesService,
    @Inject(DOCUMENT_INTAKE) private readonly intake: DocumentIntake,
  ) {}

  async requestInfo(user: SessionUser, id: string, body: InfoRequestRequest): Promise<CaseDetail> {
    this.officerOnly(user);
    const types = [...new Set(body.documents ?? [])];
    const message = body.message?.trim() ?? "";
    const errors: FieldError[] = [];
    if (!types.length || types.some((t) => !Object.values(DocumentType).includes(t))) {
      errors.push({ field: "documents", message: "Pick at least one document to request." });
    }
    if (!message) {
      errors.push({ field: "message", message: "Write the message the borrower sees." });
    }
    if (!DUE_IN_DAYS.includes(body.dueInDays)) {
      errors.push({ field: "dueInDays", message: "Choose a due date: in 3 or 5 days." });
    }
    if (errors.length) throw validation("Check the request.", errors);

    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      this.check(() => assertTransition("REQUEST_INFO", c.status));
      const docs = await this.repo.documents(c.id, m);
      const refusal = requestRefusal(docs);
      if (refusal) throw invalidState(refusal);
      const open = requestableTypes(docs);
      const blocked = types.filter((t) => !open.includes(t));
      if (blocked.length) {
        throw validation("Some documents cannot be requested again.", [
          {
            field: "documents",
            message: `Already verified: ${blocked.map((t) => DOCUMENT_TYPE_LABEL[t]).join("; ")}.`,
          },
        ]);
      }

      const now = new Date();
      for (const type of types) {
        const existing = docs.find((d) => d.documentType === type);
        const doc = existing ?? this.repo.newDocument(m);
        if (existing) {
          doc.attempt += 1;
          clearUpload(doc);
        } else {
          doc.caseId = c.id;
          doc.documentType = type;
          doc.attempt = 1;
        }
        doc.status = DocumentStatus.Requested;
        doc.requestedBy = user.id;
        doc.requestedAt = now;
        await this.repo.saveDocument(m, doc);
      }
      const dueOn = businessDate(expiresAt(now, body.dueInDays));
      c.infoRequestDocuments = types;
      c.infoRequestMessage = message;
      c.infoRequestDue = dueOn;
      c.infoRequestedBy = user.id;
      c.infoRequestedAt = now;
      this.check(() => moveTo(c, "REQUEST_INFO", CaseStatus.InfoRequested));
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "INFO_REQUESTED",
        summary: `Requested from the borrower: ${types.map((t) => DOCUMENT_TYPE_LABEL[t]).join("; ")} (due ${dueOn}).`,
        fromStatus: CaseStatus.Review,
        toStatus: CaseStatus.InfoRequested,
        details: { documents: types, dueOn, message },
      });
    });
    return this.cases.get(user, id);
  }

  /**
   * The borrower's upload, simulated (PRD DOC-001). The provider is called outside the
   * transaction with a key per document and attempt, so a retry after a timeout gets the same
   * file; the case and the document are checked again under the lock before anything is
   * written, and an outage writes nothing.
   */
  async simulateUpload(user: SessionUser, id: string, type: DocumentType): Promise<CaseDetail> {
    this.officerOnly(user);
    const before = await this.cases.visible(user, id);
    const doc = await this.awaitedDocument(before, type);
    let received: ReceivedDocument;
    try {
      received = await this.intake.receive({
        idempotencyKey: `doc-${doc.id}-a${doc.attempt}`,
        applicationId: before.id,
        documentType: type,
      });
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      throw new DomainError(
        503,
        ProblemCode.ProviderUnavailable,
        `The document upload service ${err.failure === "TIMEOUT" ? "did not answer in time" : err.failure === "MALFORMED" ? "sent a reply that could not be read" : "is unavailable"}. Nothing was recorded: try again.`,
      );
    }

    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      const docs = await this.repo.documents(c.id, m);
      const current = await this.awaitedDocument(c, type, docs);
      if (current.attempt !== doc.attempt) {
        throw invalidState("The document was requested again meanwhile. Reload the case.");
      }
      current.status = DocumentStatus.Received;
      current.uploadReference = received.reference;
      current.fileName = received.fileName;
      current.contentType = received.contentType;
      current.sizeBytes = received.sizeBytes;
      current.pages = received.pages;
      current.receivedAt = new Date(received.receivedAt);
      current.providerMode = received.mode;
      await this.repo.saveDocument(m, current);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "DOCUMENT_RECEIVED",
        summary: `Received ${DOCUMENT_TYPE_LABEL[type]} from the borrower (simulated upload, ${received.reference}).`,
        details: { documentType: type, reference: received.reference, attempt: current.attempt },
      });
      const stillAwaited = docs.filter(
        (d) => d.id !== current.id && d.status === DocumentStatus.Requested,
      );
      if (!stillAwaited.length) {
        this.check(() => moveTo(c, "INFO_RECEIVED", CaseStatus.Review));
        await this.repo.saveCase(m, c);
        await this.activity.record(m, {
          caseId: c.id,
          actor: "SYSTEM",
          systemName: "Document checklist",
          action: "INFO_RECEIVED",
          summary: "Every requested document has arrived: back to review.",
          fromStatus: CaseStatus.InfoRequested,
          toStatus: CaseStatus.Review,
        });
      }
    });
    return this.cases.get(user, id);
  }

  /** The loan officer verifies or rejects a received document. */
  async review(
    user: SessionUser,
    id: string,
    type: DocumentType,
    body: DocumentReviewRequest,
  ): Promise<CaseDetail> {
    this.officerOnly(user);
    const reason = body.reason?.trim() ?? "";
    if (body.decision === "REJECTED" && !reason) {
      throw validation("Say why the document is rejected.", [
        { field: "reason", message: "Enter what is wrong with the document." },
      ]);
    }
    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      if (c.status !== CaseStatus.Review && c.status !== CaseStatus.InfoRequested) {
        throw invalidState("Documents are reviewed while the case is in review.");
      }
      const doc = (await this.repo.documents(c.id, m)).find((d) => d.documentType === type);
      if (!doc || doc.status !== DocumentStatus.Received) {
        throw invalidState(
          `${DOCUMENT_TYPE_LABEL[type]} has not been received, so there is nothing to review.`,
        );
      }
      const verified = body.decision === "VERIFIED";
      doc.status = verified ? DocumentStatus.Verified : DocumentStatus.Rejected;
      doc.reviewedBy = user.id;
      doc.reviewedAt = new Date();
      doc.rejectionReason = verified ? null : reason;
      await this.repo.saveDocument(m, doc);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: verified ? "DOCUMENT_VERIFIED" : "DOCUMENT_REJECTED",
        summary: verified
          ? `Verified ${DOCUMENT_TYPE_LABEL[type]}.`
          : `Rejected ${DOCUMENT_TYPE_LABEL[type]}: ${reason}`,
        details: {
          documentType: type,
          reference: doc.uploadReference,
          reason: verified ? null : reason,
        },
      });
    });
    return this.cases.get(user, id);
  }

  /** The requested document waiting for the borrower, or 409 when there is none. */
  private async awaitedDocument(
    c: LoanCaseEntity,
    type: DocumentType,
    docs?: CaseDocumentEntity[],
  ): Promise<CaseDocumentEntity> {
    if (c.status !== CaseStatus.InfoRequested) {
      throw invalidState("The borrower can upload only while information is requested.");
    }
    const doc = (docs ?? (await this.repo.documents(c.id))).find((d) => d.documentType === type);
    if (!doc || doc.status !== DocumentStatus.Requested) {
      throw invalidState(`${DOCUMENT_TYPE_LABEL[type]} is not waiting for an upload.`);
    }
    return doc;
  }

  private officerOnly(user: SessionUser): void {
    if (user.role !== Role.LoanOfficer) {
      throw forbiddenRole("Only a loan officer can request or review documents.");
    }
  }

  private async lock(m: EntityManager, user: SessionUser, id: string): Promise<LoanCaseEntity> {
    const c = await this.repo.lockCase(m, id);
    if (!c || !canView(user, c)) throw notFound();
    return c;
  }

  private check(step: () => void): void {
    try {
      step();
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw invalidState(err.message);
      throw err;
    }
  }
}

function clearUpload(doc: CaseDocumentEntity): void {
  doc.uploadReference = null;
  doc.fileName = null;
  doc.contentType = null;
  doc.sizeBytes = null;
  doc.pages = null;
  doc.receivedAt = null;
  doc.providerMode = null;
  doc.reviewedBy = null;
  doc.reviewedAt = null;
  doc.rejectionReason = null;
}
