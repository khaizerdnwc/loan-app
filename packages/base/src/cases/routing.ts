import { CaseStatus, Priority } from "@loan/core";

/**
 * Queue routing rules (PRD WF-002), shared by the case view, `allowedActions` and the routing
 * service so they say the same thing. The service checks them again under the case's lock.
 */

/** The statuses in which a case is with the loan officers, and so has an owner (or none). */
export const OFFICER_STAGES: readonly CaseStatus[] = [
  CaseStatus.Draft,
  CaseStatus.Review,
  CaseStatus.InfoRequested,
];

export function withOfficers(status: CaseStatus): boolean {
  return OFFICER_STAGES.includes(status);
}

/** Whether a loan officer may pick the case now: in review (or waiting on the borrower), unowned. */
export function canPick(c: { status: CaseStatus; ownerId: string | null }): boolean {
  return (
    (c.status === CaseStatus.Review || c.status === CaseStatus.InfoRequested) && c.ownerId === null
  );
}

/** The officers' queue order: HIGH priority first, then the longest-waiting (oldest change). */
export function queueOrder<T extends { priority: Priority; updatedAt: Date }>(a: T, b: T): number {
  const rank = (x: T) => (x.priority === Priority.High ? 0 : 1);
  return rank(a) - rank(b) || a.updatedAt.getTime() - b.updatedAt.getTime();
}
