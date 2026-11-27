"use client";

import {
  CASE_STATUSES,
  type CaseStatus,
  type CaseSummary,
  type Role,
  STATUS_LABEL,
} from "@loan/core";
import { SegmentedFilter, StatCard } from "@loan/ui";
import { CaseTable } from "@/components/case-table";

/** The stages present in a queue, in the order the lifecycle reaches them. */
export function stagesIn(items: CaseSummary[]): CaseStatus[] {
  return CASE_STATUSES.filter((s) => items.some((c) => c.status === s));
}

export type StageFilter = CaseStatus | "ALL";

/**
 * Counts and a stage filter from the queue the page already loaded (no team or SLA figures:
 * the API does not provide them in this release), then the table filtered to that stage.
 *
 * - One card per stage only when the queue holds more than one (otherwise it repeats the
 *   total), and the filter likewise.
 * - "Escalated" only on the approver's queue: an approval refused above someone's authority
 *   stays in APPROVAL and moves to the queue of an approver whose authority covers it (R-6).
 *   The flag is never cleared, so a returned or approved case can carry it into other
 *   queues (the row's Escalated pill shows it); the card is only meaningful to approvers.
 * - A chosen stage that is no longer in the queue falls back to All, so the table never
 *   hides everything behind a filter that is gone.
 */
export function QueueBody({
  staffRole,
  items,
  stage,
  onStage,
  empty,
}: {
  staffRole: Role;
  items: CaseSummary[];
  stage: StageFilter;
  onStage: (s: StageFilter) => void;
  empty: string;
}) {
  const stages = stagesIn(items);
  const filtering = stages.length > 1;
  const current: StageFilter =
    filtering && stage !== "ALL" && stages.includes(stage) ? stage : "ALL";
  const shown = current === "ALL" ? items : items.filter((c) => c.status === current);
  const count = (s: CaseStatus) => items.filter((c) => c.status === s).length;
  return (
    <>
      <ul aria-label="Queue figures" className="mb-4 flex flex-wrap gap-3">
        <li className="max-w-[280px] min-w-[200px] flex-1">
          <StatCard label="In my queue" value={items.length} />
        </li>
        {filtering &&
          stages.slice(0, 3).map((s) => (
            <li key={s} className="max-w-[280px] min-w-[200px] flex-1">
              <StatCard label={STATUS_LABEL[s]} value={count(s)} />
            </li>
          ))}
        {staffRole === "APPROVER" && (
          <li className="max-w-[280px] min-w-[200px] flex-1">
            <StatCard
              label="Escalated"
              value={items.filter((c) => c.escalated).length}
              note="from a lower approval limit"
            />
          </li>
        )}
      </ul>
      {filtering && (
        <div className="mb-4">
          <SegmentedFilter
            label="Filter by stage"
            value={current}
            onChange={onStage}
            options={[
              { value: "ALL" as const, label: "All", count: items.length },
              ...stages.map((s) => ({ value: s, label: STATUS_LABEL[s], count: count(s) })),
            ]}
          />
        </div>
      )}
      <CaseTable cases={shown} empty={empty} />
    </>
  );
}
