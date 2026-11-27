import { E_SIGNATURE, type ESignature, isProviderUnavailable } from "@loan/contracts";
import {
  type CaseDetail,
  type CaseList,
  CaseStatus,
  CONSENT_TERMS_VERSION,
  type ConsentInput,
  type CreateCaseRequest,
  DecisionOutcome,
  type DeclineRequest,
  Money,
  ProblemCode,
  Recommendation,
  type RecommendRequest,
  Role,
  type UpdateDraftRequest,
  WITHDRAW_REASON_LABEL,
  type WithdrawRequest,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import { TransactionRunner } from "../database/transaction-runner";
import { ActivityService } from "./activity.service";
import { authorityProblem, canView, recommendationRefusal } from "./case-access";
import { CaseViews } from "./case-views";
import { CasesRepository } from "./cases.repository";
import { CONSENT_CHANNEL, consentComplete } from "./consent";
import { DecisionService } from "./decision.service";
import {
  authorityExceeded,
  DomainError,
  invalidState,
  makerChecker,
  notFound,
  overrideReasonRequired,
  validation,
} from "./domain-error";
import { LoanCaseEntity } from "./entities/loan-case.entity";
import {
  assertTransition,
  type CaseEvent,
  InvalidTransitionError,
  moveTo,
  startDraft,
} from "./lifecycle";
import { businessDate, expiryRefusal, PERSONAL_LOAN, termErrors } from "./product";

const OUTCOME_STATUS: Record<DecisionOutcome, CaseStatus> = {
  AUTO_APPROVE: CaseStatus.Offer,
  REFER: CaseStatus.Review,
  AUTO_DECLINE: CaseStatus.Declined,
};

/**
 * Application capture, the automated decision, referral review, approval and signing.
 * Every state change: lock the case, check the transition and the rule, change it, write
 * the activity event — one transaction. Booking lives in BookingService.
 */
@Injectable()
export class CasesService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CasesRepository,
    private readonly staff: StaffRepository,
    private readonly activity: ActivityService,
    private readonly decisions: DecisionService,
    private readonly views: CaseViews,
    @Inject(E_SIGNATURE) private readonly eSignature: ESignature,
  ) {}

  // --- reads -------------------------------------------------------------------------------

  async list(user: SessionUser, view: "queue" | "all"): Promise<CaseList> {
    let cases = await this.repo.list(user, view);
    if (user.role === Role.Approver && view === "queue") {
      const me = await this.staff.findById(user.id);
      cases = cases.filter((c) => me !== null && authorityProblem(me, c) === null);
    }
    return { items: await this.views.summaries(cases) };
  }

  async get(user: SessionUser, id: string): Promise<CaseDetail> {
    return this.views.detail(user, await this.visible(user, id));
  }

  async visible(user: SessionUser, id: string): Promise<LoanCaseEntity> {
    const c = await this.repo.findCase(id);
    if (!c || !canView(user, c)) throw notFound();
    return c;
  }

  // --- capture -----------------------------------------------------------------------------

  async create(user: SessionUser, body: CreateCaseRequest): Promise<CaseDetail> {
    const amount = parseAmount(body.amount);
    const errors = termErrors(amount, body.tenorMonths);
    if (!body.purpose?.trim())
      errors.push({ field: "purpose", message: "Enter the purpose of the loan." });
    const applicant = await this.repo.findApplicant(body.applicantId);
    if (!applicant) errors.push({ field: "applicantId", message: "Choose an applicant." });
    if (errors.length || !amount || !applicant)
      throw validation("Check the highlighted fields.", errors);

    if (body.consent) this.checkConsentInput(body.consent);
    // Capture-and-submit without full consent would leave a draft behind a 400: refuse first.
    if (body.submit && !consentComplete(body.consent ?? null)) throw consentRequired();
    const id = await this.tx
      .run(async (m) => {
        // One open application per applicant and product (INT-007). The partial unique index
        // holds it under a race; this names the open case for the officer.
        const open = await this.repo.findOpenCase(applicant.id, PERSONAL_LOAN.code, m);
        if (open) throw duplicateApplication(applicant.fullName, open.reference);
        const c = new LoanCaseEntity();
        c.reference = await this.repo.nextReference(m);
        c.applicant = applicant;
        c.applicantId = applicant.id;
        c.productCode = PERSONAL_LOAN.code;
        c.requestedAmount = amount;
        c.requestedTenorMonths = body.tenorMonths;
        c.purpose = body.purpose.trim();
        startDraft(c);
        c.createdBy = user.id;
        const saved = await this.repo.saveCase(m, c);
        await this.activity.record(m, {
          caseId: saved.id,
          actor: user,
          action: "CASE_CREATED",
          summary: `Created draft ${saved.reference}: ₱${amount.toString()} over ${body.tenorMonths} months for ${applicant.fullName}.`,
          toStatus: CaseStatus.Draft,
        });
        if (body.consent) await this.recordConsent(m, user, saved, body.consent);
        return saved.id;
      })
      .catch(async (err: unknown) => {
        // A race the pre-check could not see: the partial unique index refused the second insert.
        // Mapped outside the rolled-back transaction, so the lookup does not hold two connections.
        if (!isUniqueViolation(err, OPEN_APPLICATION_INDEX)) throw err;
        const winner = await this.repo.findOpenCase(applicant.id, PERSONAL_LOAN.code);
        throw duplicateApplication(applicant.fullName, winner?.reference ?? "another case");
      });
    return body.submit ? this.submit(user, id) : this.get(user, id);
  }

  async updateDraft(user: SessionUser, id: string, body: UpdateDraftRequest): Promise<CaseDetail> {
    if (body.consent) this.checkConsentInput(body.consent);
    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      if (c.status !== CaseStatus.Draft) throw invalidState("Only a draft can be edited.");
      // One expiry gate for every write on a draft (a consent-only edit too): an expired draft
      // is closed by the sweep, never revived by an edit that would reset its age.
      refuseIfExpired(c, new Date());
      if (body.consent) await this.recordConsent(m, user, c, body.consent);
      const changesTerms =
        body.amount !== undefined || body.tenorMonths !== undefined || body.purpose !== undefined;
      if (!changesTerms) return;
      const amount = body.amount === undefined ? c.requestedAmount : parseAmount(body.amount);
      const tenor = body.tenorMonths ?? c.requestedTenorMonths;
      const errors = termErrors(amount, tenor);
      if (body.purpose !== undefined && !body.purpose.trim()) {
        errors.push({ field: "purpose", message: "Enter the purpose of the loan." });
      }
      if (errors.length || !amount) throw validation("Check the highlighted fields.", errors);
      const before = {
        amount: c.requestedAmount.toString(),
        tenorMonths: c.requestedTenorMonths,
        purpose: c.purpose,
      };
      c.requestedAmount = amount;
      c.requestedTenorMonths = tenor;
      if (body.purpose !== undefined) c.purpose = body.purpose.trim();
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "DRAFT_UPDATED",
        summary: "Updated the draft.",
        details: {
          before,
          after: { amount: amount.toString(), tenorMonths: tenor, purpose: c.purpose },
        },
      });
    });
    return this.get(user, id);
  }

  /** Run the automated decision on a draft (F1-1, F2-1). */
  async submit(user: SessionUser, id: string): Promise<CaseDetail> {
    const draft = await this.visible(user, id);
    if (draft.status !== CaseStatus.Draft)
      throw invalidState("This application has already been submitted.");
    refuseIfExpired(draft, new Date());
    // No consent, no bureau pull (PRD INT-006, AIS-002): checked before any provider call.
    if (!consentComplete(await this.repo.latestConsent(draft.id))) throw consentRequired();
    // Providers are called before the transaction: no row lock is held while they answer.
    const inputs = await this.decisions.gatherInputs(draft, businessDate());

    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("SUBMIT", c.status);
      // The inputs were gathered outside the lock: refuse if the draft changed meanwhile, so
      // the decision record always explains the terms it approves (ADR 0022 R2).
      if (c.version !== draft.version) {
        throw invalidState("The draft changed while it was being decided. Submit it again.");
      }
      // Re-checked under the lock: the draft may have reached its expiry while the providers answered.
      refuseIfExpired(c, new Date());
      // Consent edits do not change the case's version, so read it again under the lock: a
      // consent withdrawn while the providers answered stops the decision (INT-006).
      if (!consentComplete(await this.repo.latestConsent(c.id, m))) {
        throw consentRequired();
      }
      const { record, result } = await this.decisions.decideAndRecord(m, c, inputs, user.id);
      const to = OUTCOME_STATUS[result.outcome];
      this.move(c, "SUBMIT", to);
      if (to === CaseStatus.Offer) c.offeredAt = new Date();
      c.decisionId = record.id;
      c.grade = result.grade;
      if (result.outcome === DecisionOutcome.Approve && result.monthlyRate) {
        c.approvedAmount = c.requestedAmount;
        c.approvedTenorMonths = c.requestedTenorMonths;
        c.approvedMonthlyRate = result.monthlyRate;
      }
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "CASE_SUBMITTED",
        summary: "Submitted for decision.",
      });
      await this.activity.record(m, {
        caseId: c.id,
        actor: "SYSTEM",
        action: "DECISION_MADE",
        summary: describeDecision(
          result.outcome,
          result.score,
          result.grade,
          result.reasonCodes.map((r) => r.code),
        ),
        fromStatus: CaseStatus.Draft,
        toStatus: to,
        details: {
          decisionId: record.id,
          ruleSet: record.ruleSetVersion,
          scorecard: record.scorecardVersion,
          automationMode: record.automationMode,
          killSwitch: record.killSwitch,
          engineOutcome: record.engineOutcome,
        },
      });
    });
    return this.get(user, id);
  }

  /**
   * Decide a referred case again once the providers answer (PRD NFR-005): a case referred
   * because the bureau or screening was down has no score or grade, so nobody could approve
   * it. Only such a case may be re-decided; the earlier record stays (insert-only) and the
   * case points to the new one, whose outcome moves the case as a submission would.
   */
  async redecide(user: SessionUser, id: string): Promise<CaseDetail> {
    const current = await this.visible(user, id);
    this.transition("REDECIDE", current.status);
    const previous = current.decisionId ? await this.repo.findDecision(current.decisionId) : null;
    if (!DecisionService.decidedDuringOutage(previous)) {
      throw invalidState(
        "This case was decided with every provider answering; there is nothing to decide again.",
      );
    }
    // No consent, no bureau pull: also on a re-decision (e.g. a case from before consent).
    if (!consentComplete(await this.repo.latestConsent(current.id))) throw consentRequired();
    const inputs = await this.decisions.gatherInputs(current, businessDate());
    const stillDown = DecisionService.unavailableProvider(inputs);
    if (stillDown) {
      // Nothing is written: another outage record would add nothing, and each try is a
      // provider call (a bureau inquiry, with a real bureau).
      throw new DomainError(
        503,
        ProblemCode.ProviderUnavailable,
        `${stillDown} still cannot answer. Decide the case again once it is back.`,
      );
    }

    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("REDECIDE", c.status);
      if (c.version !== current.version) {
        throw invalidState("The case changed while it was being decided. Try again.");
      }
      const { record, result } = await this.decisions.decideAndRecord(m, c, inputs, user.id);
      const to = OUTCOME_STATUS[result.outcome];
      this.move(c, "REDECIDE", to);
      if (to === CaseStatus.Offer) c.offeredAt = new Date();
      // The new automated decision starts the case afresh: nobody has recommended, approved
      // or escalated it under this decision (the earlier actors are kept in the event).
      const cleared = {
        recommendation: c.recommendation,
        recommendedBy: c.recommendedBy,
        approvedBy: c.approvedBy,
        escalated: c.escalated,
      };
      c.recommendation = null;
      c.recommendedBy = null;
      c.recommendedAmount = null;
      c.recommendedTenorMonths = null;
      c.isOverride = false;
      c.overrideReason = null;
      c.recommendationRationale = null;
      c.approvedBy = null;
      c.escalated = false;
      c.decisionId = record.id;
      c.grade = result.grade;
      if (result.outcome === DecisionOutcome.Approve && result.monthlyRate) {
        c.approvedAmount = c.requestedAmount;
        c.approvedTenorMonths = c.requestedTenorMonths;
        c.approvedMonthlyRate = result.monthlyRate;
      }
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "REDECIDED",
        summary: `Decided again after a provider outage. ${describeDecision(
          result.outcome,
          result.score,
          result.grade,
          result.reasonCodes.map((r) => r.code),
        )}`,
        fromStatus: CaseStatus.Review,
        toStatus: to,
        details: {
          decisionId: record.id,
          previousDecisionId: previous?.id ?? null,
          ruleSet: record.ruleSetVersion,
          scorecard: record.scorecardVersion,
          cleared,
        },
      });
    });
    return this.get(user, id);
  }

  // --- referral review (officer) -----------------------------------------------------------

  async recommend(user: SessionUser, id: string, body: RecommendRequest): Promise<CaseDetail> {
    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("RECOMMEND", c.status);
      if (!body.rationale?.trim()) {
        throw validation("Explain the recommendation.", [
          { field: "rationale", message: "Enter a rationale." },
        ]);
      }
      if (body.type !== Recommendation.Decline && c.decisionId) {
        const decision = await this.repo.findDecision(c.decisionId);
        // After an outage, or a failed knockout referred because automation was not live,
        // only a decline may be recommended (the case view lists the same refusal).
        const refusal = recommendationRefusal(
          DecisionService.decidedDuringOutage(decision),
          DecisionService.knockedOut(decision),
        );
        if (refusal) throw invalidState(refusal);
      }
      let amount: Money | null = null;
      let tenor: number | null = null;
      if (body.type === Recommendation.Approve) {
        amount = c.requestedAmount;
        tenor = c.requestedTenorMonths;
      } else if (body.type === Recommendation.CounterOffer) {
        amount = body.amount === undefined ? null : parseAmount(body.amount);
        tenor = body.tenorMonths ?? null;
        const errors = termErrors(amount, tenor);
        if (errors.length) throw validation("Check the counter-offer terms.", errors);
      }
      // An override is a recommendation that changes what was applied for and scored, or
      // declines it: it needs a reason code (PRD 7.4, LND-AIS-011).
      const isOverride =
        body.type === Recommendation.Decline ||
        (body.type === Recommendation.CounterOffer &&
          (!amount?.equals(c.requestedAmount) || tenor !== c.requestedTenorMonths));
      if (isOverride && !body.overrideReason) {
        throw overrideReasonRequired(
          "This recommendation differs from the application that was scored: choose a reason code.",
        );
      }
      c.recommendedBy = user.id;
      c.recommendation = body.type;
      c.recommendedAmount = amount;
      c.recommendedTenorMonths = tenor;
      c.isOverride = isOverride;
      c.overrideReason = isOverride ? (body.overrideReason ?? null) : null;
      c.recommendationRationale = body.rationale.trim();
      this.move(c, "RECOMMEND", CaseStatus.Approval);
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: isOverride ? "RECOMMENDED_WITH_OVERRIDE" : "RECOMMENDED",
        summary:
          body.type === Recommendation.Decline
            ? "Recommended a decline."
            : `Recommended ${body.type === Recommendation.CounterOffer ? "a counter-offer of" : "approval of"} ₱${amount?.toString()} over ${tenor} months${isOverride ? ` (override, reason ${body.overrideReason})` : ""}.`,
        fromStatus: CaseStatus.Review,
        toStatus: CaseStatus.Approval,
        details: {
          type: body.type,
          amount: amount?.toString() ?? null,
          tenorMonths: tenor,
          overrideReason: c.overrideReason,
          rationale: c.recommendationRationale,
        },
      });
    });
    return this.get(user, id);
  }

  // --- approval (approver) ----------------------------------------------------------------

  async approve(user: SessionUser, id: string): Promise<CaseDetail> {
    const refusal = await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("APPROVE", c.status);
      if (c.recommendedBy === user.id) {
        throw makerChecker("You made this recommendation; a different approver must approve it.");
      }
      if (c.recommendation === Recommendation.Decline) {
        throw invalidState(
          "The recommendation is to decline: confirm the decline or return the case.",
        );
      }
      // Defence in depth: recommend already refuses this, but nothing decided during an
      // outage may be approved, whatever path brought it to APPROVAL.
      const decision = c.decisionId ? await this.repo.findDecision(c.decisionId) : null;
      if (DecisionService.decidedDuringOutage(decision)) {
        throw invalidState(
          "This case was decided while a provider could not answer (no score, or no sanctions screening), so it cannot be approved. Return it so the loan officer can decide it again.",
        );
      }
      const me = await this.staff.findById(user.id, m);
      const problem = me ? authorityProblem(me, c) : "Your authority could not be read.";
      if (problem) {
        // Escalate, and commit the flag even though the approval is refused (R-6).
        if (!c.escalated) {
          c.escalated = true;
          await this.repo.saveCase(m, c);
          await this.activity.record(m, {
            caseId: c.id,
            actor: user,
            action: "ESCALATED",
            summary: `Approval refused: ${problem}`,
          });
        }
        return problem;
      }
      const rate = c.grade ? await this.decisionRate(c) : null;
      if (!c.recommendedAmount || !c.recommendedTenorMonths || !rate) {
        throw invalidState("This case has no approvable terms.");
      }
      c.approvedBy = user.id;
      c.approvedAmount = c.recommendedAmount;
      c.approvedTenorMonths = c.recommendedTenorMonths;
      c.approvedMonthlyRate = rate;
      this.move(c, "APPROVE", CaseStatus.Offer);
      c.offeredAt = new Date();
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "APPROVED",
        summary: `Approved ₱${c.approvedAmount.toString()} over ${c.approvedTenorMonths} months at ${rate} a month (grade ${c.grade}).`,
        fromStatus: CaseStatus.Approval,
        toStatus: CaseStatus.Offer,
        details: {
          amount: c.approvedAmount.toString(),
          tenorMonths: c.approvedTenorMonths,
          monthlyRate: rate,
          grade: c.grade,
        },
      });
      return null;
    });
    if (refusal) throw authorityExceeded(refusal);
    return this.get(user, id);
  }

  async decline(user: SessionUser, id: string, body: DeclineRequest): Promise<CaseDetail> {
    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("DECLINE", c.status);
      c.declineReason = body.reasonCode;
      c.declineNote = body.note?.trim() || null;
      // The approver who acted on the case: it stays visible to them after it leaves APPROVAL.
      c.approvedBy = user.id;
      this.move(c, "DECLINE", CaseStatus.Declined);
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "DECLINED",
        summary: `Declined (${body.reasonCode}).`,
        fromStatus: CaseStatus.Approval,
        toStatus: CaseStatus.Declined,
        details: { reasonCode: body.reasonCode, note: body.note ?? null },
      });
    });
    return this.get(user, id);
  }

  async returnToReview(user: SessionUser, id: string): Promise<CaseDetail> {
    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("RETURN", c.status);
      this.move(c, "RETURN", CaseStatus.Review);
      c.approvedBy = user.id;
      // A returned case starts its approval afresh: the officer's next recommendation is a new
      // request, so an earlier refusal above authority no longer applies.
      const wasEscalated = c.escalated;
      c.escalated = false;
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "RETURNED",
        summary: wasEscalated
          ? "Returned to the loan officer for another look; the escalation is cleared."
          : "Returned to the loan officer for another look.",
        fromStatus: CaseStatus.Approval,
        toStatus: CaseStatus.Review,
        details: { escalationCleared: wasEscalated },
      });
    });
    return this.get(user, id);
  }

  // --- signing (simulated borrower side) -----------------------------------------------------

  async sign(user: SessionUser, id: string): Promise<CaseDetail> {
    const c0 = await this.visible(user, id);
    this.transition("SIGN", c0.status);
    // An expired offer is never sent for signature; the sweep closes it as EXPIRED.
    refuseIfExpired(c0, new Date());
    let envelope: string;
    try {
      const result = await this.eSignature.sign({
        idempotencyKey: `sig-${c0.id}`,
        applicationId: c0.id,
        signerName: c0.applicant.fullName,
        documentTitle: "Loan agreement and disclosure statement",
      });
      envelope = result.envelopeId;
    } catch (err) {
      if (isProviderUnavailable(err)) {
        throw new DomainError(
          503,
          ProblemCode.ProviderUnavailable,
          "E-signature is unavailable right now. Try again shortly.",
        );
      }
      throw err;
    }
    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("SIGN", c.status);
      // Re-checked under the lock: the offer may have expired while e-signature answered.
      refuseIfExpired(c, new Date());
      c.signatureEnvelopeId = envelope;
      this.move(c, "SIGN", CaseStatus.Booking);
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "SIGNED",
        summary: `Borrower signed the loan agreement (simulated e-signature, envelope ${envelope}).`,
        fromStatus: CaseStatus.Offer,
        toStatus: CaseStatus.Booking,
      });
    });
    return this.get(user, id);
  }

  // --- withdrawal (loan officer); expiry is ExpiryService ------------------------------------

  /**
   * The loan officer closes an application that will not go ahead (PRD WF-012), from any
   * status before signing: DRAFT, REVIEW, APPROVAL or OFFER. The case leaves the applicant's
   * open applications, so a new one can be captured (INT-007).
   */
  async withdraw(user: SessionUser, id: string, body: WithdrawRequest): Promise<CaseDetail> {
    await this.tx.run(async (m) => {
      const c = await this.lockOrFail(m, user, id);
      this.transition("WITHDRAW", c.status);
      const from = c.status;
      const note = body.note?.trim() || null;
      c.withdrawReason = body.reasonCode;
      c.withdrawNote = note;
      this.move(c, "WITHDRAW", CaseStatus.Withdrawn);
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "WITHDRAWN",
        summary: `Withdrew the application: ${WITHDRAW_REASON_LABEL[body.reasonCode]}.`,
        fromStatus: from,
        toStatus: CaseStatus.Withdrawn,
        details: { reasonCode: body.reasonCode, note },
      });
    });
    return this.get(user, id);
  }

  // --- helpers ------------------------------------------------------------------------------

  private checkConsentInput(consent: ConsentInput): void {
    if (consent.termsVersion !== CONSENT_TERMS_VERSION) {
      throw validation("These are not the current terms and conditions.", [
        {
          field: "consent.termsVersion",
          message: `The current terms are version ${CONSENT_TERMS_VERSION}.`,
        },
      ]);
    }
  }

  private async recordConsent(
    m: EntityManager,
    user: SessionUser,
    c: LoanCaseEntity,
    consent: ConsentInput,
  ): Promise<void> {
    await this.repo.insertConsent(m, {
      caseId: c.id,
      applicantId: c.applicantId,
      creditBureauCheck: consent.creditBureauCheck,
      dataProcessing: consent.dataProcessing,
      termsVersion: consent.termsVersion,
      channel: CONSENT_CHANNEL,
      capturedBy: user.id,
    });
    const given = [
      consent.creditBureauCheck ? "credit bureau check" : null,
      consent.dataProcessing ? "data processing" : null,
    ].filter(Boolean);
    await this.activity.record(m, {
      caseId: c.id,
      actor: user,
      action: "CONSENT_RECORDED",
      summary: given.length
        ? `Recorded the applicant's consent (${given.join(", ")}; terms ${consent.termsVersion}) at the branch.`
        : `Recorded that the applicant has not consented (terms ${consent.termsVersion}).`,
      details: {
        creditBureauCheck: consent.creditBureauCheck,
        dataProcessing: consent.dataProcessing,
        termsVersion: consent.termsVersion,
        channel: CONSENT_CHANNEL,
      },
    });
  }

  private async decisionRate(c: LoanCaseEntity): Promise<string | null> {
    if (!c.decisionId) return null;
    return (await this.repo.findDecision(c.decisionId))?.monthlyRate ?? null;
  }

  private async lockOrFail(
    m: EntityManager,
    user: SessionUser,
    id: string,
  ): Promise<LoanCaseEntity> {
    const c = await this.repo.lockCase(m, id);
    if (!c || !canView(user, c)) throw notFound();
    return c;
  }

  private transition(event: CaseEvent, from: CaseStatus): void {
    asInvalidState(() => assertTransition(event, from));
  }

  private move(c: LoanCaseEntity, event: CaseEvent, to: CaseStatus): void {
    asInvalidState(() => moveTo(c, event, to));
  }
}

function asInvalidState(check: () => void): void {
  try {
    check();
  } catch (err) {
    if (err instanceof InvalidTransitionError) throw invalidState(err.message);
    throw err;
  }
}

/** The partial unique index behind INT-007 (migration 1764300000005). */
export const OPEN_APPLICATION_INDEX = "UQ_loan_case_open_per_applicant_product";

function duplicateApplication(name: string, reference: string): DomainError {
  return new DomainError(
    409,
    ProblemCode.DuplicateApplication,
    `${name} already has an open ${PERSONAL_LOAN.name.toLowerCase()} application (${reference}). Continue that one, or withdraw it first.`,
  );
}

/** A Postgres unique violation (23505) on the named constraint or index. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const driver = (err as { driverError?: { code?: string; constraint?: string } }).driverError;
  return driver?.code === "23505" && driver.constraint === constraint;
}

/** Refuses (409) a write on a draft or offer that has expired but the sweep has not closed yet. */
function refuseIfExpired(c: LoanCaseEntity, now: Date): void {
  const refusal = expiryRefusal(c, now);
  if (refusal) throw invalidState(refusal);
}

function consentRequired(): DomainError {
  return validation("Record the applicant's consent before submitting.", [
    {
      field: "consent",
      message: `The applicant must consent to the credit bureau check and to data processing under terms ${CONSENT_TERMS_VERSION}.`,
    },
  ]);
}

function parseAmount(raw: string | undefined): Money | null {
  if (raw === undefined || raw === null || raw === "") return null;
  try {
    return Money.of(String(raw));
  } catch {
    return null;
  }
}

function describeDecision(
  outcome: DecisionOutcome,
  score: number | null,
  grade: string | null,
  codes: string[],
): string {
  const scored = score === null ? "not scored" : `score ${score}, grade ${grade}`;
  const label = {
    AUTO_APPROVE: "Auto-approved",
    REFER: "Referred to a loan officer",
    AUTO_DECLINE: "Auto-declined",
  }[outcome];
  return `${label} (${scored}${codes.length ? `; reasons ${codes.join(", ")}` : ""}).`;
}
