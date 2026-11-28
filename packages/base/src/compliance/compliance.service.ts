import { KYC_AML, type KycAml, type ScreeningResult } from "@loan/contracts";
import {
  type AmlEscalationView,
  type CloseEscalationRequest,
  EscalationOutcome,
  EscalationStatus,
  ProblemCode,
  Role,
  ScreeningStage,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import { ActivityService } from "../cases/activity.service";
import {
  DomainError,
  forbiddenRole,
  invalidState,
  notFound,
  validation,
} from "../cases/domain-error";
import type { DecisionRecordEntity } from "../cases/entities/decision-record.entity";
import type { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { TransactionRunner } from "../database/transaction-runner";
import { type DecisionResult, REASONS } from "../decisioning/engine";
import { ComplianceRepository } from "./compliance.repository";
import { AmlEscalationEntity } from "./entities/aml-escalation.entity";

/** Screening before disbursement matched a list: nothing is booked, Compliance is told. */
export class ScreeningMatchError extends Error {
  constructor(readonly result: ScreeningResult) {
    super("Pre-disbursement screening matched a watchlist.");
    this.name = "ScreeningMatchError";
  }
}

/** What the screening before disbursement found, for the booking's activity event. */
export interface PreDisbursementScreening {
  screenedAt: string;
  providerMode: string;
  /** Set when a match was found and Compliance had already cleared it as a false positive. */
  clearedByEscalationId: string | null;
}

/**
 * AML escalations (PRD CMP-005, F6). Opened when the decision knocks an application out on a
 * sanctions match, and when the screening run again before disbursement matches; worked by
 * Compliance (acknowledge, close with an outcome and notes). Every change is one transaction
 * with its case activity event (and so its audit log entry). The escalations are opened
 * inside the lending transaction that holds the case lock, so the partial unique index (one
 * unclosed escalation per case and stage) is a backstop, never a race to map.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: ComplianceRepository,
    private readonly staff: StaffRepository,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    @Inject(KYC_AML) private readonly kycAml: KycAml,
  ) {}

  // --- opened by the lending workflow (in the caller's transaction) -------------------------

  /** After a decision: a sanctions knockout opens an escalation for Compliance. */
  async escalateIfSanctioned(
    m: EntityManager,
    c: LoanCaseEntity,
    record: DecisionRecordEntity,
    result: DecisionResult,
  ): Promise<void> {
    if (!result.reasonCodes.some((r) => r.code === REASONS.sanctionsMatch.code)) return;
    const earlier = await this.repo.forCase(c.id, ScreeningStage.Onboarding, m);
    if (earlier.some((e) => e.status !== EscalationStatus.Closed)) return;
    const e = this.newEscalation(c, ScreeningStage.Onboarding, "SYSTEM");
    e.decisionId = record.id;
    e.matchedList = null;
    e.providerMode = record.providerMode;
    e.screenedAt = record.createdAt;
    const saved = await this.repo.save(m, e);
    await this.activity.record(m, {
      caseId: c.id,
      actor: "SYSTEM",
      action: "AML_ESCALATION_OPENED",
      summary: "AML review opened for Compliance.",
      details: { escalationId: saved.id, stage: ScreeningStage.Onboarding, decisionId: record.id },
    });
  }

  /**
   * Run in the checker's booking transaction, with the case locked, before anything is booked:
   * refuse while an escalation holds the booking, then screen again (PRD CMP-005). A match
   * throws ScreeningMatchError unless Compliance already cleared that same match as a false
   * positive; an unavailable provider throws ProviderUnavailableError (the booking is held,
   * never declined).
   */
  async screenBeforeDisbursement(
    m: EntityManager,
    c: LoanCaseEntity,
  ): Promise<PreDisbursementScreening> {
    const earlier = await this.repo.forCase(c.id, ScreeningStage.PreDisbursement, m);
    const hold = holdReason(earlier);
    if (hold) throw new DomainError(409, ProblemCode.ComplianceHold, hold);
    const a = c.applicant;
    const result = await this.kycAml.screen(
      {
        applicantId: a.id,
        fullName: a.fullName,
        birthDate: a.birthDate,
        governmentIdLast4: a.governmentIdLast4,
      },
      ScreeningStage.PreDisbursement,
    );
    let clearedByEscalationId: string | null = null;
    if (result.sanctionsMatch) {
      const cleared = earlier.find(
        (e) =>
          e.outcome === EscalationOutcome.FalsePositive && e.matchedList === result.matchedList,
      );
      if (!cleared) throw new ScreeningMatchError(result);
      clearedByEscalationId = cleared.id;
    }
    return { screenedAt: result.screenedAt, providerMode: result.mode, clearedByEscalationId };
  }

  /**
   * After a pre-disbursement match: open the escalation (once) in the failure's transaction.
   * `priorAttempts` counts earlier booking attempts under the same key: after a lost reply
   * (ADR 0020) core banking may already hold the account and the payout, and Compliance
   * must know that.
   */
  async escalateBeforeDisbursement(
    m: EntityManager,
    user: SessionUser,
    c: LoanCaseEntity,
    result: ScreeningResult,
    priorAttempts: number,
  ): Promise<void> {
    const earlier = await this.repo.forCase(c.id, ScreeningStage.PreDisbursement, m);
    if (earlier.some((e) => e.status !== EscalationStatus.Closed)) return;
    const e = this.newEscalation(c, ScreeningStage.PreDisbursement, user.id);
    e.decisionId = null;
    e.matchedList = result.matchedList;
    e.providerMode = result.mode;
    e.screenedAt = new Date(result.screenedAt);
    e.priorBookingAttempts = priorAttempts;
    const saved = await this.repo.save(m, e);
    // The case history (read by case workers) says only that a review holds the booking; the
    // list that matched goes to the escalation and the audit log (no tipping-off).
    await this.activity.record(m, {
      caseId: c.id,
      actor: user,
      action: "AML_ESCALATION_OPENED",
      summary: "AML review opened: the booking is held for Compliance.",
      details: { escalationId: saved.id, stage: ScreeningStage.PreDisbursement, priorAttempts },
      auditOnly: {
        summary: `Screening before disbursement matched ${result.matchedList ?? "a watchlist"}; the booking is held for Compliance.`,
        details: { matchedList: result.matchedList },
      },
    });
  }

  /**
   * A match found by a booking attempt whose case another supervisor has meanwhile booked: no
   * booking is held, but the match is recorded in the audit log, in the caller's transaction.
   */
  async recordLateMatch(
    m: EntityManager,
    user: SessionUser,
    caseId: string,
    result: ScreeningResult,
  ): Promise<void> {
    await this.audit.append(m, {
      actor: user,
      action: "PRE_DISBURSEMENT_MATCH_AFTER_BOOKING",
      summary: `Screening before disbursement matched ${result.matchedList ?? "a watchlist"} after the case was already booked by another attempt.`,
      caseId,
      details: { matchedList: result.matchedList, screenedAt: result.screenedAt },
    });
  }

  /** Why a booking cannot go ahead now, for the case view; null when nothing holds it. */
  async bookingHold(caseId: string): Promise<string | null> {
    return holdReason(await this.repo.forCase(caseId, ScreeningStage.PreDisbursement));
  }

  // --- Compliance's work ------------------------------------------------------------------

  async list(user: SessionUser, openOnly: boolean): Promise<AmlEscalationView[]> {
    this.requireCompliance(user);
    return this.views(await this.repo.list(openOnly));
  }

  async get(user: SessionUser, id: string): Promise<AmlEscalationView> {
    this.requireCompliance(user);
    const e = await this.repo.find(id);
    if (!e) throw notFound("escalation");
    const [v] = await this.views([e]);
    return v as AmlEscalationView;
  }

  async acknowledge(user: SessionUser, id: string): Promise<AmlEscalationView> {
    this.requireCompliance(user);
    await this.tx.run(async (m) => {
      const e = await this.lockOrFail(m, id);
      if (e.status !== EscalationStatus.Open) {
        throw invalidState(
          e.status === EscalationStatus.Closed
            ? "This escalation is already closed."
            : "This escalation is already acknowledged.",
        );
      }
      e.status = EscalationStatus.Acknowledged;
      e.acknowledgedBy = user.id;
      e.acknowledgedAt = new Date();
      await this.repo.save(m, e);
      await this.activity.record(m, {
        caseId: e.caseId,
        actor: user,
        action: "AML_ESCALATION_ACKNOWLEDGED",
        summary: "AML review acknowledged by Compliance.",
        details: { escalationId: e.id, from: EscalationStatus.Open, to: e.status },
      });
    });
    return this.get(user, id);
  }

  async close(
    user: SessionUser,
    id: string,
    body: CloseEscalationRequest,
  ): Promise<AmlEscalationView> {
    this.requireCompliance(user);
    const notes = body.notes?.trim() ?? "";
    if (!notes) {
      throw validation("Explain how the escalation was resolved.", [
        { field: "notes", message: "Enter the closing notes." },
      ]);
    }
    await this.tx.run(async (m) => {
      const e = await this.lockOrFail(m, id);
      if (e.status === EscalationStatus.Closed) {
        throw invalidState("This escalation is already closed.");
      }
      const from = e.status;
      e.status = EscalationStatus.Closed;
      e.closedBy = user.id;
      e.closedAt = new Date();
      e.outcome = body.outcome;
      e.closingNotes = notes;
      await this.repo.save(m, e);
      await this.activity.record(m, {
        caseId: e.caseId,
        actor: user,
        action: "AML_ESCALATION_CLOSED",
        // Case workers read the case history: it says what happens to the booking, never
        // Compliance's outcome reasoning or notes (those stay in the escalation and the log).
        summary: caseHistorySummary(e),
        details: { escalationId: e.id, from, to: e.status },
        auditOnly: {
          summary: `Compliance closed the AML escalation (${
            body.outcome === EscalationOutcome.FalsePositive
              ? "false positive, cleared"
              : "match confirmed"
          }). ${effectOf(e)}`,
          details: { outcome: body.outcome, notes },
        },
      });
    });
    return this.get(user, id);
  }

  // --- helpers ----------------------------------------------------------------------------

  private newEscalation(
    c: LoanCaseEntity,
    stage: ScreeningStage,
    openedBy: string,
  ): AmlEscalationEntity {
    const e = new AmlEscalationEntity();
    e.caseId = c.id;
    e.applicantId = c.applicantId;
    e.stage = stage;
    e.status = EscalationStatus.Open;
    e.openedBy = openedBy;
    e.acknowledgedBy = null;
    e.acknowledgedAt = null;
    e.closedBy = null;
    e.closedAt = null;
    e.outcome = null;
    e.closingNotes = null;
    e.priorBookingAttempts = 0;
    return e;
  }

  private async lockOrFail(m: EntityManager, id: string): Promise<AmlEscalationEntity> {
    const e = await this.repo.lock(m, id);
    if (!e) throw notFound("escalation");
    return e;
  }

  /** Defence in depth: the controller's @Roles already admits only Compliance. */
  private requireCompliance(user: SessionUser): void {
    if (user.role !== Role.Compliance) {
      throw forbiddenRole("Only Compliance works AML escalations.");
    }
  }

  private async views(rows: AmlEscalationEntity[]): Promise<AmlEscalationView[]> {
    const ids = rows.flatMap((e) => [e.openedBy, e.acknowledgedBy, e.closedBy]);
    const names = await this.staff.namesById(ids.filter((x): x is string => !!x));
    const name = (id: string | null) =>
      id === null ? null : id === "SYSTEM" ? "Decision engine" : (names.get(id) ?? id);
    return rows.map((e) => ({
      id: e.id,
      caseId: e.caseId,
      caseReference: e.loanCase?.reference ?? "",
      applicantName: e.loanCase?.applicant?.fullName ?? "",
      stage: e.stage,
      matchedList: e.matchedList,
      providerMode: e.providerMode,
      screenedAt: e.screenedAt.toISOString(),
      status: e.status,
      openedAt: e.openedAt.toISOString(),
      openedByName: name(e.openedBy) ?? "",
      acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
      acknowledgedByName: name(e.acknowledgedBy),
      closedAt: e.closedAt?.toISOString() ?? null,
      closedByName: name(e.closedBy),
      outcome: e.outcome,
      notes: e.closingNotes,
      priorBookingAttempts: e.priorBookingAttempts,
      effect: effectOf(e),
    }));
  }
}

/** Why the pre-disbursement escalations hold a booking, or null when none does. */
function holdReason(escalations: AmlEscalationEntity[]): string | null {
  const latest = escalations[0];
  if (!latest) return null;
  if (latest.status !== EscalationStatus.Closed) {
    return "Held for Compliance: screening before disbursement matched. Compliance reviews the match; once they clear it, a supervisor can retry the booking.";
  }
  if (latest.outcome === EscalationOutcome.ConfirmedMatch) {
    return "Compliance confirmed the watchlist match found before disbursement: this loan cannot be booked.";
  }
  return null;
}

/** The closing line case workers see in the case history: the booking's fate, nothing more. */
function caseHistorySummary(e: AmlEscalationEntity): string {
  if (e.stage === ScreeningStage.Onboarding) return "AML review closed; the decline stands.";
  return e.outcome === EscalationOutcome.FalsePositive
    ? "AML review closed: the booking is released and can be retried."
    : "AML review closed: the booking stays blocked.";
}

/** What an escalation means for its case, in words (Compliance's view). */
function effectOf(e: AmlEscalationEntity): string {
  if (e.stage === ScreeningStage.Onboarding) {
    return "The application was declined by the decision; closing the escalation does not change that.";
  }
  if (e.status !== EscalationStatus.Closed) {
    return e.priorBookingAttempts > 0
      ? `The booking is held and cannot be retried until Compliance clears the match. ${e.priorBookingAttempts} earlier booking attempt(s) failed; if core banking's reply was lost, the account and payout may already exist there (same booking key).`
      : "The booking is held: nothing was booked or paid out, and it cannot be retried until Compliance clears the match.";
  }
  return e.outcome === EscalationOutcome.FalsePositive
    ? "Cleared: loan operations can retry the booking, and this match will not stop it again."
    : "Confirmed: the booking stays blocked, and the loan will not be booked.";
}
