import {
  type ActionAvailability,
  type ApprovalException,
  type CaseAction,
  CaseStatus,
  type DocumentType,
  ProblemCode,
  Recommendation,
  type RecommendationAvailability,
  Role,
} from "@loan/core";
import type { ApprovalLevelEntity } from "../auth/approval-level.entity";
import type { SessionUser } from "../auth/session";
import type { StaffEntity } from "../auth/staff.entity";
import { authorityProblem, escalates } from "./approval-matrix";
import { OPERATIONS_STAGES } from "./cases.repository";
import { REQUESTABLE_TYPES } from "./documents";
import type { BookingRequestEntity } from "./entities/booking.entities";
import type { LoanCaseEntity } from "./entities/loan-case.entity";
import { canHappen } from "./lifecycle";
import { expiryRefusal } from "./product";
import { canPick, withOfficers } from "./routing";

/**
 * Who may see a case (docs/API.md). Outside this, the API answers 404 so the case's
 * existence is not revealed.
 */
export function canView(user: SessionUser, c: LoanCaseEntity): boolean {
  switch (user.role) {
    case Role.LoanOfficer:
    case Role.Compliance:
      return true;
    case Role.Approver:
      return c.status === CaseStatus.Approval || c.approvedBy === user.id;
    case Role.LoanOperations:
    case Role.LoanOperationsSupervisor:
      return OPERATIONS_STAGES.includes(c.status);
    default:
      return false;
  }
}

/**
 * Why only a decline may be recommended on this decision, or null when every type may be: a
 * decision made during a provider outage, or one where a policy knockout failed (referred
 * because automation was not live). CasesService.recommend refuses with the same words.
 */
export function recommendationRefusal(
  decidedDuringOutage: boolean,
  knockedOut: boolean,
): string | null {
  if (decidedDuringOutage) {
    return "This case was decided while a provider could not answer (no score, no sanctions screening, or no fraud check), so it cannot be recommended for approval. Decide it again once the provider is back, or recommend a decline.";
  }
  if (knockedOut) {
    return "A policy knockout failed for this application (see the policy rules), so it can only be recommended for decline.";
  }
  return null;
}

/** Each recommendation type with whether the API accepts it now (mirrors CasesService.recommend). */
export function recommendationTypes(refusal: string | null): RecommendationAvailability[] {
  return [Recommendation.Approve, Recommendation.CounterOffer, Recommendation.Decline].map(
    (type) =>
      refusal && type !== Recommendation.Decline
        ? { type, enabled: false, blockedBy: ProblemCode.InvalidTransition, detail: refusal }
        : { type, enabled: true },
  );
}

const ROLE_ACTIONS: Record<Role, CaseAction[]> = {
  LOAN_OFFICER: [
    "EDIT_DRAFT",
    "SUBMIT",
    "REDECIDE",
    "REQUEST_INFO",
    "PICK",
    "REASSIGN",
    "SET_PRIORITY",
    "RECOMMEND",
    "WITHDRAW",
    "REPRODUCE_DECISION",
  ],
  APPROVER: ["APPROVE", "DECLINE", "RETURN", "REPRODUCE_DECISION"],
  LOAN_OPERATIONS: ["SIGN", "SUBMIT_BOOKING"],
  LOAN_OPERATIONS_SUPERVISOR: ["SIGN", "SUBMIT_BOOKING", "APPROVE_BOOKING", "RETRY_BOOKING"],
  COMPLIANCE: ["REPRODUCE_DECISION"],
  ADMIN: [],
};

const ACTION_EVENT: Partial<Record<CaseAction, Parameters<typeof canHappen>[0]>> = {
  SUBMIT: "SUBMIT",
  REDECIDE: "REDECIDE",
  REQUEST_INFO: "REQUEST_INFO",
  RECOMMEND: "RECOMMEND",
  APPROVE: "APPROVE",
  DECLINE: "DECLINE",
  RETURN: "RETURN",
  SIGN: "SIGN",
  SUBMIT_BOOKING: "SUBMIT_BOOKING",
  WITHDRAW: "WITHDRAW",
};

/**
 * The actions the signed-in user's role could take on the case in its current status,
 * each enabled or disabled with the rule that refuses it (docs/API.md). The services
 * enforce the same rules when the action is posted; this only describes them.
 */
export function allowedActions(
  user: SessionUser,
  c: LoanCaseEntity,
  staff: StaffEntity | null,
  booking: BookingRequestEntity | null,
  /** The case's current decision was made while a provider could not answer. */
  decidedDuringOutage = false,
  /** The latest consent is complete (INT-006); submitting is refused until it is. */
  consentComplete = true,
  /**
   * Why the pre-booking checklist refuses SUBMIT_BOOKING, APPROVE_BOOKING and RETRY_BOOKING
   * now (checklistRefusal), or null.
   */
  bookingRefusal: string | null = null,
  /** Why an AML escalation holds the booking (PRD CMP-005), or null. */
  bookingHold: string | null = null,
  /**
   * The document checklist's refusals (documents.ts): why REQUEST_INFO cannot be sent now, and
   * why RECOMMEND must wait (a received document is not verified or rejected yet).
   */
  documents: {
    request: string | null;
    recommend: string | null;
    /** The types a request may ask for now (requestableTypes). */
    requestable?: DocumentType[];
  } = {
    request: null,
    recommend: null,
  },
  /**
   * The approval matrix (WF-004): the case's exception types and every level, so a refused
   * APPROVE names the level to route it to.
   */
  matrix: { exceptions: ApprovalException[]; levels: ApprovalLevelEntity[] } = {
    exceptions: [],
    levels: [],
  },
): ActionAvailability[] {
  const out: ActionAvailability[] = [];
  for (const action of ROLE_ACTIONS[user.role]) {
    const event = ACTION_EVENT[action];
    if (event && !canHappen(event, c.status)) continue;
    if (action === "EDIT_DRAFT" && c.status !== CaseStatus.Draft) continue;
    if (action === "REPRODUCE_DECISION" && !c.decisionId) continue;
    // Queue routing (WF-002): only while the case is with the loan officers.
    if (action === "PICK" && !canPick(c)) continue;
    if ((action === "REASSIGN" || action === "SET_PRIORITY") && !withOfficers(c.status)) continue;
    if (action === "REDECIDE" && !decidedDuringOutage) continue;
    if (action === "REDECIDE" && !consentComplete) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.Validation,
        detail:
          "This case has no complete consent on record, so the bureau cannot be checked again. Recommend a decline instead.",
      });
      continue;
    }
    // One expiry gate for every write on a draft or offer: the same wording as the API's 409.
    const expired =
      action === "EDIT_DRAFT" || action === "SUBMIT" || action === "SIGN"
        ? expiryRefusal(c, new Date())
        : null;
    if (expired) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.InvalidTransition,
        detail: expired,
      });
      continue;
    }
    if (action === "SUBMIT" && !consentComplete) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.Validation,
        detail:
          "Record the applicant's consent to the credit bureau check and to data processing first.",
      });
      continue;
    }
    // The document checklist (WF-007): the same wording as the API's 409.
    const documentRefusal =
      action === "REQUEST_INFO"
        ? documents.request
        : action === "RECOMMEND"
          ? documents.recommend
          : null;
    if (documentRefusal) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.InvalidTransition,
        detail: documentRefusal,
      });
      continue;
    }
    if (action === "APPROVE_BOOKING" && c.status !== CaseStatus.PendingChecker) continue;
    if (action === "RETRY_BOOKING" && c.status !== CaseStatus.BookingFailed) continue;

    if (action === "APPROVE") {
      if (decidedDuringOutage) {
        out.push({
          action,
          enabled: false,
          blockedBy: ProblemCode.InvalidTransition,
          detail:
            "This case was decided while a provider could not answer (no score, no sanctions screening, or no fraud check), so it cannot be approved. Return it so the loan officer can decide it again.",
        });
        continue;
      }
      if (c.recommendation === Recommendation.Decline) {
        out.push({
          action,
          enabled: false,
          blockedBy: ProblemCode.InvalidTransition,
          detail: "The recommendation is to decline: confirm the decline or return the case.",
        });
        continue;
      }
      if (c.recommendedBy === user.id) {
        out.push({
          action,
          enabled: false,
          blockedBy: ProblemCode.MakerChecker,
          detail: "You made this recommendation; a different approver must approve it.",
        });
        continue;
      }
      const problem = staff
        ? authorityProblem(staff, c, matrix.exceptions, matrix.levels)
        : "Your authority could not be read.";
      if (problem) {
        // Clickable (it escalates) only when the approver holds a level and another level of
        // the matrix covers the case; otherwise approving leads nowhere: decline or return it.
        const escalatable = escalates(staff ?? null, c, matrix.exceptions, matrix.levels);
        out.push({
          action,
          enabled: false,
          blockedBy: ProblemCode.AuthorityLimit,
          detail: problem,
          ...(escalatable ? { escalates: true as const } : {}),
        });
        continue;
      }
    }
    if ((action === "APPROVE_BOOKING" || action === "RETRY_BOOKING") && bookingHold) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.ComplianceHold,
        detail: bookingHold,
      });
      continue;
    }
    if (
      (action === "APPROVE_BOOKING" || action === "RETRY_BOOKING") &&
      booking?.makerId === user.id
    ) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.MakerChecker,
        detail: "You submitted this booking; a different supervisor must approve it.",
      });
      continue;
    }
    // The pre-booking checklist (BKG-001), checked at the maker step and again by the checker
    // (and on a retry): the same wording as the API's 409.
    if (
      (action === "SUBMIT_BOOKING" || action === "APPROVE_BOOKING" || action === "RETRY_BOOKING") &&
      bookingRefusal
    ) {
      out.push({
        action,
        enabled: false,
        blockedBy: ProblemCode.BookingChecklistIncomplete,
        detail: bookingRefusal,
      });
      continue;
    }
    if (action === "REQUEST_INFO") {
      out.push({
        action,
        enabled: true,
        documentTypes: documents.requestable ?? [...REQUESTABLE_TYPES],
      });
      continue;
    }
    out.push({ action, enabled: true });
  }
  return out;
}
