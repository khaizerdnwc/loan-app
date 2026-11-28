import {
  APPROVAL_EXCEPTION_LABEL,
  ApprovalException,
  type Grade,
  Money,
  OverrideReason,
} from "@loan/core";
import type { ApprovalLevelEntity } from "../auth/approval-level.entity";

/**
 * The approval matrix's rule (PRD WF-004), pure so the case view, the approver's queue and the
 * approval itself say the same thing. An approver's authority is their level in the matrix,
 * read from the staff table (with the level) inside the approval's transaction, never from the
 * session token.
 */

export interface MatrixCase {
  productCode: string;
  /** The applicant on record now (a related party flagged after the decision still counts). */
  applicant?: { relatedParty: boolean };
  requestedAmount: Money;
  recommendedAmount: Money | null;
  grade: Grade | null;
  isOverride: boolean;
  overrideReason: string | null;
}

/** The decision's own facts the matrix reads (whatever version decided it). */
export interface MatrixDecision {
  inputs: { applicant: { relatedParty?: boolean } };
}

/** What makes approving this case an exception (only levels delegated it may approve). */
export function caseExceptions(
  c: MatrixCase,
  decision: MatrixDecision | null,
): ApprovalException[] {
  const out: ApprovalException[] = [];
  if (c.isOverride) out.push(ApprovalException.Override);
  if (c.overrideReason === OverrideReason.PolicyException) {
    out.push(ApprovalException.PolicyException);
  }
  // Related party per the decision's snapshot OR the applicant on record, whichever says so.
  if (decision?.inputs.applicant.relatedParty === true || c.applicant?.relatedParty === true) {
    out.push(ApprovalException.RelatedParty);
  }
  return out;
}

/**
 * Why a level does not cover the case, as staff-readable clauses (empty when it does): the
 * product, the amount to approve against its cap, the grade, and each exception it is not
 * delegated.
 */
export function levelProblems(
  level: ApprovalLevelEntity,
  c: MatrixCase,
  exceptions: ApprovalException[],
): string[] {
  const amount = c.recommendedAmount ?? c.requestedAmount;
  const problems: string[] = [];
  if (level.productCode !== c.productCode) {
    problems.push(`your level (${level.code}) does not cover the ${c.productCode} product`);
  }
  // A missing limit is no authority, never an unlimited one.
  const limit = level.maxAmount ?? Money.zero();
  if (amount.greaterThan(limit)) {
    problems.push(`₱${amount.toString()} is above your approval limit of ₱${limit.toString()}`);
  }
  if (!c.grade || !level.grades.includes(c.grade)) {
    problems.push(
      `grade ${c.grade ?? "none"} is outside the grades you may approve (${level.grades.join(", ") || "none"})`,
    );
  }
  for (const e of exceptions) {
    if (!level.exceptions.includes(e)) {
      const what = APPROVAL_EXCEPTION_LABEL[e].toLowerCase();
      problems.push(
        `${/^[aeiou]/.test(what) ? "an" : "a"} ${what} is not delegated to ${level.code}`,
      );
    }
  }
  return problems;
}

/**
 * Whether an approver's level covers the case; the reason when it does not, naming the lowest
 * level that would (from `levels`), so the case can be routed.
 */
export function authorityProblem(
  approver: { approvalLevel: ApprovalLevelEntity | null },
  c: MatrixCase,
  exceptions: ApprovalException[],
  levels: ApprovalLevelEntity[] = [],
): string | null {
  const level = approver.approvalLevel;
  if (!level) return "You hold no level in the approval matrix, so you cannot approve.";
  const problems = levelProblems(level, c, exceptions);
  if (!problems.length) return null;
  const route = coveringLevel(levels, c, exceptions);
  return `${problems.join(", and ")}. ${
    route
      ? `Route it to ${route.code} · ${route.name} or above.`
      : "No level of the approval matrix covers it: decline it or return it (a credit committee is not part of this release)."
  }`;
}

/** The lowest level of the matrix that covers the case, or null when none does. */
export function coveringLevel(
  levels: ApprovalLevelEntity[],
  c: MatrixCase,
  exceptions: ApprovalException[],
): ApprovalLevelEntity | null {
  return (
    [...levels]
      .sort((a, b) => a.rank - b.rank)
      .find((l) => levelProblems(l, c, exceptions).length === 0) ?? null
  );
}

/**
 * Whether a refused approval escalates the case: only when the approver holds a level and some
 * level of the matrix covers the case. Otherwise there is nobody to escalate to (decline or
 * return it). Shared by the case view (Approve stays clickable) and the approve refusal (the
 * escalated flag), so the two never disagree.
 */
export function escalates(
  approver: { approvalLevel: ApprovalLevelEntity | null } | null,
  c: MatrixCase,
  exceptions: ApprovalException[],
  levels: ApprovalLevelEntity[],
): boolean {
  return Boolean(approver?.approvalLevel) && coveringLevel(levels, c, exceptions) !== null;
}
