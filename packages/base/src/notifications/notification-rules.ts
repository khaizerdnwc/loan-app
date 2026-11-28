import type { MessageChannel } from "@loan/contracts";
import { CaseStatus, Role } from "@loan/core";

/** What a case event means for people: staff alerts and borrower messages (PRD NTF-001/002). */
export interface NotificationPlan {
  alerts: { role: Role; staffId: string | null; kind: string; title: string }[];
  messages: { template: BorrowerTemplate; channels: MessageChannel[] }[];
}

export type BorrowerTemplate =
  | "UNDER_REVIEW"
  | "OFFER_READY"
  | "DECLINED"
  | "DOCUMENTS_REQUESTED"
  | "DISBURSED"
  | "WITHDRAWN";

/**
 * Borrower wording: plain, borrower-safe (no score, reason code, list or internal step), and
 * the case reference only. Rendered once into the delivery log; the gateway gets the words
 * and a recipient reference, never an address.
 */
export const BORROWER_TEMPLATES: Record<BorrowerTemplate, { subject: string; body: string }> = {
  UNDER_REVIEW: {
    subject: "Your WhiteBank loan application is being reviewed",
    body: "Your application {ref} needs a review by our credit team. We will contact you within one business day.",
  },
  OFFER_READY: {
    subject: "Your WhiteBank loan offer is ready",
    body: "Your application {ref} is approved. Review and sign your loan offer in the WhiteBank app.",
  },
  DECLINED: {
    subject: "An update on your WhiteBank loan application",
    body: "We are unable to approve your application {ref} at this time. The WhiteBank app shows the reasons and what you can do next.",
  },
  DOCUMENTS_REQUESTED: {
    subject: "WhiteBank needs a few documents from you",
    body: "To continue with your application {ref}, please upload the requested documents in the WhiteBank app.",
  },
  DISBURSED: {
    subject: "Your WhiteBank loan has been released",
    body: "Your loan for application {ref} is booked and the funds have been sent to your WhiteBank account.",
  },
  WITHDRAWN: {
    subject: "Your WhiteBank loan application is closed",
    body: "Your application {ref} has been withdrawn. You can apply again at any time.",
  },
};

/** The event as the activity history records it. */
export interface CaseEventFacts {
  action: string;
  actorId: string;
  toStatus: CaseStatus | null;
  details: Record<string, unknown>;
  reference: string;
  /** The officer who owns the case (PRD WF-002), when one does. */
  ownerId: string | null;
}

const BOTH: MessageChannel[] = ["EMAIL", "SMS"];

/**
 * The plan for one case event. Pure. Nobody is alerted about their own action, and nothing
 * about an AML review ever goes to the borrower (no tipping-off).
 */
export function planFor(e: CaseEventFacts): NotificationPlan {
  const plan: NotificationPlan = { alerts: [], messages: [] };
  const role = (r: Role, kind: string, title: string) =>
    plan.alerts.push({ role: r, staffId: null, kind, title });
  const person = (staffId: unknown, r: Role, kind: string, title: string) => {
    if (typeof staffId === "string" && staffId && staffId !== e.actorId) {
      plan.alerts.push({ role: r, staffId, kind, title });
    }
  };
  const tell = (template: BorrowerTemplate, channels: MessageChannel[] = ["EMAIL"]) =>
    plan.messages.push({ template, channels });

  switch (e.action) {
    case "CASE_PICKED":
      person(e.details.ownerId, Role.LoanOfficer, "ASSIGNED", `${e.reference} is now yours`);
      break;
    case "CASE_REASSIGNED":
      person(
        e.details.toOwnerId,
        Role.LoanOfficer,
        "ASSIGNED",
        `${e.reference} was reassigned to you`,
      );
      break;
    case "DECISION_MADE":
    case "REDECIDED":
      if (e.toStatus === CaseStatus.Offer) {
        role(
          Role.LoanOperations,
          "OFFER_TO_SIGN",
          `${e.reference} is approved: record the e-signature`,
        );
        tell("OFFER_READY", BOTH);
      } else if (e.toStatus === CaseStatus.Review) {
        tell("UNDER_REVIEW");
      } else if (e.toStatus === CaseStatus.Declined) {
        tell("DECLINED");
      }
      break;
    case "RECOMMENDED":
    case "RECOMMENDED_WITH_OVERRIDE":
      role(Role.Approver, "APPROVAL_WAITING", `${e.reference} is waiting for your approval`);
      break;
    case "ESCALATED":
      role(Role.Approver, "ESCALATED", `${e.reference} needs an approver with higher authority`);
      break;
    case "APPROVED":
      role(
        Role.LoanOperations,
        "OFFER_TO_SIGN",
        `${e.reference} is approved: record the e-signature`,
      );
      tell("OFFER_READY", BOTH);
      break;
    case "RETURNED":
      // To the owning officer; a case nobody owns goes back to the loan officers as a role.
      if (e.ownerId) {
        person(e.ownerId, Role.LoanOfficer, "RETURNED", `${e.reference} was returned to you`);
      } else {
        role(Role.LoanOfficer, "RETURNED", `${e.reference} was returned for review`);
      }
      break;
    case "DECLINED":
      tell("DECLINED");
      break;
    case "INFO_REQUESTED":
      tell("DOCUMENTS_REQUESTED", BOTH);
      break;
    case "BOOKING_SUBMITTED":
      role(
        Role.LoanOperationsSupervisor,
        "BOOKING_TO_CHECK",
        `${e.reference} is waiting for a booking check`,
      );
      break;
    case "BOOKING_FAILED":
      role(
        Role.LoanOperationsSupervisor,
        "BOOKING_FAILED",
        `${e.reference}: the booking failed or is held`,
      );
      break;
    case "BOOKING_APPROVED":
    case "BOOKING_RETRIED":
      tell("DISBURSED", BOTH);
      break;
    case "AML_ESCALATION_OPENED":
      role(Role.Compliance, "AML_REVIEW", `${e.reference}: an AML review is waiting for you`);
      break;
    case "WITHDRAWN":
      tell("WITHDRAWN");
      break;
    default:
      break;
  }
  return plan;
}
