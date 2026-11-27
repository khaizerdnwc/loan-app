import { CORE_BANKING, type CoreBanking } from "@loan/contracts";
import type {
  ActivityView,
  ApplicantView,
  BookingView,
  CaseDetail,
  CaseSummary,
  DecisionRecordView,
  DeclineReason,
  LoanAccountView,
  ProblemCode,
} from "@loan/core";
import { Money } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import { allowedActions } from "./case-access";
import { CasesRepository } from "./cases.repository";
import { ageOn } from "./decision.service";
import type { ActivityEventEntity } from "./entities/activity-event.entity";
import type { ApplicantEntity } from "./entities/applicant.entity";
import type { BookingRequestEntity } from "./entities/booking.entities";
import type { DecisionRecordEntity } from "./entities/decision-record.entity";
import type { LoanCaseEntity } from "./entities/loan-case.entity";

/** Entities → the HTTP contract (packages/core/src/api.ts). Money always leaves as strings. */
@Injectable()
export class CaseViews {
  constructor(
    private readonly repo: CasesRepository,
    private readonly staff: StaffRepository,
    @Inject(CORE_BANKING) private readonly core: CoreBanking,
  ) {}

  async summaries(cases: LoanCaseEntity[]): Promise<CaseSummary[]> {
    const outcomes = new Map<string, DecisionRecordEntity | null>();
    for (const c of cases) {
      if (c.decisionId) outcomes.set(c.id, await this.repo.findDecision(c.decisionId));
    }
    return cases.map((c) => summary(c, outcomes.get(c.id) ?? null));
  }

  async detail(user: SessionUser, c: LoanCaseEntity): Promise<CaseDetail> {
    const decision = c.decisionId ? await this.repo.findDecision(c.decisionId) : null;
    const booking = await this.repo.findBooking(c.id);
    const account = await this.repo.findLoanAccount(c.id);
    const me = await this.staff.findById(user.id);
    const names = await this.staff.namesById(
      [c.recommendedBy, c.approvedBy, booking?.makerId].filter((x): x is string => Boolean(x)),
    );

    let regularInstalment: string | null = null;
    if (c.approvedAmount && c.approvedTenorMonths && c.approvedMonthlyRate) {
      const q = await this.core.quote({
        principal: c.approvedAmount,
        monthlyRate: c.approvedMonthlyRate,
        tenorMonths: c.approvedTenorMonths,
      });
      regularInstalment = q.regularInstalment.toString();
    }

    return {
      ...summary(c, decision),
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
      signatureEnvelopeId: c.signatureEnvelopeId,
      booking: booking ? bookingView(booking, names.get(booking.makerId) ?? booking.makerId) : null,
      loanAccountId: account?.id ?? null,
      allowedActions: allowedActions(user, c, me, booking),
    };
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

function summary(c: LoanCaseEntity, decision: DecisionRecordEntity | null): CaseSummary {
  return {
    id: c.id,
    reference: c.reference,
    applicantName: c.applicant.fullName,
    productCode: c.productCode,
    requestedAmount: c.requestedAmount.toString(),
    requestedTenorMonths: c.requestedTenorMonths,
    status: c.status,
    outcome: decision?.outcome ?? null,
    grade: c.grade,
    escalated: c.escalated,
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
