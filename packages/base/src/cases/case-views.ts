import {
  CORE_BANKING,
  type CoreBanking,
  isProviderUnavailable,
  type LoanTerms,
  type Quote,
} from "@loan/contracts";
import type {
  ActivityView,
  ApplicantView,
  BookingView,
  CaseDetail,
  CaseDocumentView,
  CaseSummary,
  DecisionRecordView,
  DeclineReason,
  Grade,
  IndicativeRepaymentView,
  LoanAccountView,
  ProblemCode,
} from "@loan/core";
import { CaseStatus, Money } from "@loan/core";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import { ComplianceService } from "../compliance/compliance.service";
import { CURRENT_RULE_SET, EXTERNAL_OUTCOME, RULE_SETS, ruleSet } from "../decisioning/engine";
import { bookingChecklist, checklistRefusal } from "./booking-checklist";
import { allowedActions, recommendationRefusal, recommendationTypes } from "./case-access";
import { CasesRepository } from "./cases.repository";
import { consentComplete } from "./consent";
import { ageOn, DecisionService } from "./decision.service";
import { documentActions, requestableTypes, requestRefusal, unreviewedRefusal } from "./documents";
import type { ActivityEventEntity } from "./entities/activity-event.entity";
import type { ApplicantEntity } from "./entities/applicant.entity";
import type { BookingRequestEntity } from "./entities/booking.entities";
import type { CaseDocumentEntity } from "./entities/case-document.entity";
import type { DecisionRecordEntity } from "./entities/decision-record.entity";
import type { LoanCaseEntity } from "./entities/loan-case.entity";
import { expiryOf, INDICATIVE_GRADE } from "./product";

/** Entities → the HTTP contract (packages/core/src/api.ts). Money always leaves as strings. */
@Injectable()
export class CaseViews {
  constructor(
    private readonly repo: CasesRepository,
    private readonly staff: StaffRepository,
    @Inject(CORE_BANKING) private readonly core: CoreBanking,
    private readonly compliance: ComplianceService,
  ) {}

  async summaries(cases: LoanCaseEntity[]): Promise<CaseSummary[]> {
    const outcomes = new Map<string, DecisionRecordEntity | null>();
    for (const c of cases) {
      if (c.decisionId) outcomes.set(c.id, await this.repo.findDecision(c.decisionId));
    }
    const names = await this.staff.namesById(
      cases.map((c) => c.ownerId).filter((x): x is string => Boolean(x)),
    );
    return cases.map((c) => summary(c, outcomes.get(c.id) ?? null, names));
  }

  async detail(user: SessionUser, c: LoanCaseEntity): Promise<CaseDetail> {
    const decision = c.decisionId ? await this.repo.findDecision(c.decisionId) : null;
    const booking = await this.repo.findBooking(c.id);
    const account = await this.repo.findLoanAccount(c.id);
    const me = await this.staff.findById(user.id);
    const consent = await this.repo.latestConsent(c.id);
    const documents = await this.repo.documents(c.id);
    // Who withdrew or expired the case, when, and from which status, is its closing event
    // (written in the same transaction as the move).
    const closing =
      c.status === CaseStatus.Withdrawn || c.status === CaseStatus.Expired
        ? await this.repo.lastEvent(c.id, c.status)
        : null;
    const withdrawn = c.status === CaseStatus.Withdrawn ? closing : null;
    const names = await this.staff.namesById(
      [
        c.recommendedBy,
        c.approvedBy,
        booking?.makerId,
        consent?.capturedBy,
        c.infoRequestedBy,
        c.ownerId,
        ...documents.map((d) => d.reviewedBy),
      ].filter((x): x is string => Boolean(x)),
    );

    let regularInstalment: string | null = null;
    if (c.approvedAmount && c.approvedTenorMonths && c.approvedMonthlyRate) {
      // Core banking quotes the instalment; when it cannot answer the case still shows (null).
      const q = await this.quoteOrNull({
        principal: c.approvedAmount,
        monthlyRate: c.approvedMonthlyRate,
        tenorMonths: c.approvedTenorMonths,
      });
      regularInstalment = q?.regularInstalment.toString() ?? null;
    }
    const checklist = bookingChecklist(c, decision, new Date());
    const outage = DecisionService.decidedDuringOutage(decision);
    const actions = allowedActions(
      user,
      c,
      me,
      booking,
      outage,
      consentComplete(consent),
      checklistRefusal(checklist),
      booking ? await this.compliance.bookingHold(c.id) : null,
      {
        request: requestRefusal(documents),
        recommend: unreviewedRefusal(documents),
        requestable: requestableTypes(documents),
      },
    );

    return {
      ...summary(c, decision, names),
      applicant: applicantView(c.applicant, today()),
      purpose: c.purpose,
      createdBy: c.createdBy,
      decision: decision ? decisionView(decision) : null,
      recommendation:
        c.recommendation && c.recommendedBy
          ? {
              by: c.recommendedBy,
              byName: names.get(c.recommendedBy) ?? c.recommendedBy,
              type: c.recommendation,
              amount: c.recommendedAmount?.toString() ?? null,
              tenorMonths: c.recommendedTenorMonths,
              isOverride: c.isOverride,
              overrideReason: c.overrideReason,
              rationale: c.recommendationRationale,
            }
          : null,
      approved:
        c.approvedAmount && c.approvedTenorMonths && c.approvedMonthlyRate
          ? {
              by: c.approvedBy,
              amount: c.approvedAmount.toString(),
              tenorMonths: c.approvedTenorMonths,
              monthlyRate: c.approvedMonthlyRate,
              regularInstalment,
            }
          : null,
      decline:
        c.declineReason && c.approvedBy
          ? {
              by: c.approvedBy,
              byName: names.get(c.approvedBy) ?? c.approvedBy,
              reasonCode: c.declineReason as DeclineReason,
              note: c.declineNote,
            }
          : null,
      withdrawal:
        c.withdrawReason && withdrawn
          ? {
              reasonCode: c.withdrawReason,
              note: c.withdrawNote,
              by: withdrawn.actorId,
              byName: withdrawn.actorName,
              at: withdrawn.createdAt.toISOString(),
            }
          : null,
      closedFrom: closing?.fromStatus ?? null,
      expiresAt: expiryOf(c)?.toISOString() ?? null,
      signatureEnvelopeId: c.signatureEnvelopeId,
      consent: consent
        ? {
            creditBureauCheck: consent.creditBureauCheck,
            dataProcessing: consent.dataProcessing,
            termsVersion: consent.termsVersion,
            channel: consent.channel,
            capturedBy: consent.capturedBy,
            capturedByName: names.get(consent.capturedBy) ?? consent.capturedBy,
            capturedAt: consent.capturedAt.toISOString(),
            complete: consentComplete(consent),
          }
        : null,
      booking: booking ? bookingView(booking, names.get(booking.makerId) ?? booking.makerId) : null,
      loanAccountId: account?.id ?? null,
      bookingChecklist: checklist,
      indicativeRepayment: decision
        ? null
        : await this.indicativeRepayment(c.requestedAmount, c.requestedTenorMonths),
      infoRequest:
        c.infoRequestDocuments && c.infoRequestMessage && c.infoRequestDue && c.infoRequestedBy
          ? {
              documents: c.infoRequestDocuments,
              message: c.infoRequestMessage,
              dueOn: c.infoRequestDue,
              requestedBy: c.infoRequestedBy,
              requestedByName: names.get(c.infoRequestedBy) ?? c.infoRequestedBy,
              requestedAt: (c.infoRequestedAt ?? c.updatedAt).toISOString(),
            }
          : null,
      documents: documents.map((d) => documentView(d, user, c.status, names)),
      proposedRepayment:
        c.status === CaseStatus.Approval &&
        c.recommendedAmount &&
        c.recommendedTenorMonths &&
        c.grade &&
        decision?.monthlyRate
          ? await this.indicativeRepayment(
              c.recommendedAmount,
              c.recommendedTenorMonths,
              c.grade,
              decision.monthlyRate,
            )
          : null,
      allowedActions: actions,
      decidedDuringOutage: outage,
      recommendationTypes: actions.some((a) => a.action === "RECOMMEND" && a.enabled)
        ? recommendationTypes(recommendationRefusal(outage, DecisionService.knockedOut(decision)))
        : [],
    };
  }

  /**
   * The indicative monthly repayment for terms before any decision (PRD INT-004): core
   * banking's quote at INDICATIVE_GRADE pricing (prototype: "at grade C pricing · calculated by
   * core"). When core cannot answer, UNAVAILABLE with no amounts: a page never breaks on it.
   * With a grade and rate, the same quote for terms awaiting approval (`proposedRepayment`).
   */
  async indicativeRepayment(
    amount: Money,
    tenorMonths: number,
    grade: Grade = INDICATIVE_GRADE,
    monthlyRate: string = ruleSet(CURRENT_RULE_SET).monthlyRate[INDICATIVE_GRADE],
  ): Promise<IndicativeRepaymentView> {
    const q = await this.quoteOrNull({ principal: amount, monthlyRate, tenorMonths });
    return {
      status: q ? "QUOTED" : "UNAVAILABLE",
      amount: amount.toString(),
      tenorMonths,
      grade,
      monthlyRate,
      regularInstalment: q?.regularInstalment.toString() ?? null,
      finalInstalment: q?.finalInstalment.toString() ?? null,
      totalRepayable: q?.totalRepayable.toString() ?? null,
      providerMode: q?.mode ?? null,
    };
  }

  /** Core banking's quote, or null when it is unavailable (outage, timeout, malformed reply). */
  private async quoteOrNull(terms: LoanTerms): Promise<Quote | null> {
    try {
      return await this.core.quote(terms);
    } catch (err) {
      if (isProviderUnavailable(err)) return null;
      throw err;
    }
  }

  decision(record: DecisionRecordEntity): DecisionRecordView {
    return decisionView(record);
  }

  activity(events: ActivityEventEntity[]): ActivityView[] {
    return events.map((e) => ({
      id: e.id,
      actorName: e.actorName,
      actorRole: e.actorRole,
      action: e.action,
      summary: e.summary,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      details: e.details,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async loanAccount(caseId: string): Promise<LoanAccountView | null> {
    const account = await this.repo.findLoanAccount(caseId);
    if (!account) return null;
    const lines = await this.repo.schedule(account.id);
    const disbursement = await this.repo.findDisbursement(account.id);
    const reconciled =
      Money.sum(lines.map((l) => l.amount)).equals(account.principal.plus(account.interest)) &&
      account.totalRepayable.equals(account.principal.plus(account.interest));
    return {
      id: account.id,
      coreAccountNumber: account.coreAccountNumber,
      principal: account.principal.toString(),
      interest: account.interest.toString(),
      totalRepayable: account.totalRepayable.toString(),
      monthlyRate: account.monthlyRate,
      tenorMonths: account.tenorMonths,
      openedAt: account.openedAt.toISOString(),
      providerMode: account.providerMode,
      reconciled,
      schedule: lines.map((l) => ({
        number: l.number,
        dueDate: l.dueDate,
        principal: l.principal.toString(),
        interest: l.interest.toString(),
        amount: l.amount.toString(),
      })),
      disbursement: disbursement
        ? {
            reference: disbursement.reference,
            amount: disbursement.amount.toString(),
            destinationAccount: disbursement.destinationAccount,
            disbursedAt: disbursement.disbursedAt.toISOString(),
          }
        : null,
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The one line a queue shows for why a case is where it is (the prototype's Reason column):
 * the referral triggers of a referred case, or the reasons of an automatic decline. The
 * summary carries the first and how many there are, so a table can say "+N more".
 */
function decisionReasons(decision: DecisionRecordEntity | null): string[] {
  if (!decision) return [];
  return decision.referralTriggers.length > 0
    ? decision.referralTriggers
    : decision.reasonCodes.map((r) => r.staff);
}

function summary(
  c: LoanCaseEntity,
  decision: DecisionRecordEntity | null,
  names: Map<string, string>,
): CaseSummary {
  return {
    id: c.id,
    reference: c.reference,
    applicantName: c.applicant.fullName,
    productCode: c.productCode,
    requestedAmount: c.requestedAmount.toString(),
    requestedTenorMonths: c.requestedTenorMonths,
    status: c.status,
    outcome: decision?.outcome ?? null,
    reason: decisionReasons(decision)[0] ?? null,
    reasonCount: decisionReasons(decision).length,
    grade: c.grade,
    escalated: c.escalated,
    ownerId: c.ownerId,
    ownerName: c.ownerId ? (names.get(c.ownerId) ?? c.ownerId) : null,
    channel: c.channel,
    priority: c.priority,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function applicantView(a: ApplicantEntity, asOf: string): ApplicantView {
  return {
    id: a.id,
    fullName: a.fullName,
    birthDate: a.birthDate,
    ageYears: ageOn(a.birthDate, asOf),
    employer: a.employer,
    employmentMonths: a.employmentMonths,
    relationshipMonths: a.relationshipMonths,
    monthlyIncome: a.monthlyIncome.toString(),
    monthlyObligations: a.monthlyObligations.toString(),
    depositAccount: a.depositAccount,
    governmentIdMasked: `•••• •••• ${a.governmentIdLast4}`,
  };
}

const bandLogger = new Logger("CaseViews");

/** The band edges of a stored record's own rule set (every stored version is kept, ADR 0022 R4). */
function scoreBandOf(version: string): DecisionRecordView["scoreBand"] {
  const rs = RULE_SETS[version];
  if (!rs) {
    // Every stored version is kept in code (ADR 0022 R4), so this means a record from a newer
    // deployment or a damaged row: show the case without a band rather than fail the view.
    bandLogger.warn(
      `Decision record names unknown rule set ${version}; shown without a score band`,
    );
    return null;
  }
  return { declineBelow: rs.declineBelow, approveFrom: rs.approveFrom };
}

function decisionView(r: DecisionRecordEntity): DecisionRecordView {
  return {
    id: r.id,
    caseId: r.caseId,
    outcome: r.outcome,
    score: r.score,
    grade: r.grade,
    ruleSetVersion: r.ruleSetVersion,
    scorecardVersion: r.scorecardVersion,
    ruleResults: r.ruleResults,
    scoreContributions: r.scoreContributions,
    reasonCodes: r.reasonCodes,
    referralTriggers: r.referralTriggers,
    debtToIncome: r.debtToIncome,
    monthlyRate: r.monthlyRate,
    providerMode: r.providerMode,
    inputs: r.inputs,
    inputsHash: r.inputsHash,
    createdAt: r.createdAt.toISOString(),
    automationMode: r.automationMode,
    killSwitch: r.killSwitch,
    // Records from before automation modes ran live: the engine's outcome is the outcome.
    engineOutcome: r.engineOutcome ?? r.outcome,
    pd: r.pd,
    recommendedAmount: r.recommendedAmount?.toString() ?? null,
    latencyMs: r.latencyMs,
    scoreBand: scoreBandOf(r.ruleSetVersion),
    externalEngine: externalEngineOf(r),
  };
}

/**
 * Who else decided (PRD DEC-008), from the stored snapshot: the role, the client engine's
 * answer and reference, and for ALONGSIDE whether it agreed (its EX-ENGINE rule passed).
 */
function externalEngineOf(r: DecisionRecordEntity): DecisionRecordView["externalEngine"] {
  const ext = r.inputs.external;
  if (!ext || ext.role === "NONE") return null;
  const rule = r.ruleResults.find((x) => x.id === "EX-ENGINE");
  const answered = ext.status === "OK";
  return {
    role: ext.role,
    outcome: answered ? EXTERNAL_OUTCOME[ext.decision] : null,
    reference: answered ? ext.reference : null,
    agreed:
      ext.role === "ALONGSIDE" && answered && rule && rule.result !== "NOT_EVALUATED"
        ? rule.result === "PASS"
        : null,
  };
}

function documentView(
  d: CaseDocumentEntity,
  user: SessionUser,
  status: CaseStatus,
  names: Map<string, string>,
): CaseDocumentView {
  return {
    type: d.documentType,
    status: d.status,
    requestedAt: d.requestedAt.toISOString(),
    upload:
      d.uploadReference && d.fileName && d.receivedAt && d.providerMode
        ? {
            reference: d.uploadReference,
            fileName: d.fileName,
            contentType: d.contentType ?? "application/pdf",
            sizeBytes: d.sizeBytes ?? 0,
            pages: d.pages ?? 0,
            virusScan: "CLEAN",
            receivedAt: d.receivedAt.toISOString(),
            providerMode: d.providerMode,
          }
        : null,
    review:
      d.reviewedBy && d.reviewedAt
        ? {
            by: d.reviewedBy,
            byName: names.get(d.reviewedBy) ?? d.reviewedBy,
            at: d.reviewedAt.toISOString(),
            rejectionReason: d.rejectionReason,
          }
        : null,
    actions: documentActions(user.role, status, d),
  };
}

function bookingView(b: BookingRequestEntity, makerName: string): BookingView {
  const [code, ...rest] = (b.lastError ?? "").split(": ");
  return {
    status: b.status,
    makerId: b.makerId,
    makerName,
    checkerId: b.checkerId,
    idempotencyKey: b.idempotencyKey,
    attempts: b.attempts,
    lastErrorCode: b.lastError ? (code as ProblemCode) : null,
    lastErrorDetail: b.lastError ? rest.join(": ") : null,
  };
}
