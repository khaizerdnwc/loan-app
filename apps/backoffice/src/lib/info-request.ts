/**
 * Whether a request for information is past its due date (PRD WF-007). The due date is a
 * business date (YYYY-MM-DD, Philippines, UTC+8); it is overdue from the day after. Shown
 * only: the API does not enforce it.
 */
export function isOverdue(dueOn: string, now: Date = new Date()): boolean {
  const today = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  return dueOn < today;
}
