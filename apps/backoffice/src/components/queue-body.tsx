"use client";

import {
  CASE_STATUSES,
  type CaseStatus,
  type CaseSummary,
  type Role,
  type SlaView,
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
 * Counts and a stage filter from the queue the page already loaded, with the stage clocks
 * (PRD WF-003) when the page has them, then the table filtered to that stage.
 *
 * - One card per stage only when the queue holds more than one (otherwise it repeats the
 *   total), and the filter likewise.
 * - "Escalated" only on the approver's queue: an approval refused above someone's authority
 *   stays in APPROVAL and moves to the queue of an approver whose authority covers it (R-6).
 *   Returning the case clears the flag. An approved or declined case keeps it as history
 *   (the row's Escalated pill shows it); the card is only meaningful to approvers.
 * - A chosen stage that is no longer in the queue falls back to All, so the table never
 *   hides everything behind a filter that is gone.
 */
export function QueueBody({
  staffRole,
  items,
  stage,
  onStage,
  empty,
  onPick,
  pickingId = null,
  sla,
}: {
  staffRole: Role;
  items: CaseSummary[];
  stage: StageFilter;
  onStage: (s: StageFilter) => void;
  empty: string;
  /** The loan officer's queue: Pick on unassigned referrals (WF-002). */
  onPick?: (c: CaseSummary) => void;
  /** The case whose Pick is in flight. */
  pickingId?: string | null;
  /** Stage clocks by case id (business time); figures and a column appear when given. */
  sla?: ReadonlyMap<string, SlaView>;
}) {
  const stages = stagesIn(items);
  const filtering = stages.length > 1;
  const current: StageFilter =
    filtering && stage !== "ALL" && stages.includes(stage) ? stage : "ALL";
  const shown = current === "ALL" ? items : items.filter((c) => c.status === current);
  const count = (s: CaseStatus) => items.filter((c) => c.status === s).length;
  return (
    <>
      {/* The prototype's .grid.g4: four figures a row, two under 1100px, one under 520px. */}
      <ul
        aria-label="Queue figures"
        data-layout="figures-grid"
        className="mb-4 grid grid-cols-1 gap-3 min-[521px]:grid-cols-2 min-[1101px]:grid-cols-4"
      >
        <li>
          <StatCard label="In my queue" value={items.length} />
        </li>
        {filtering &&
          stages.slice(0, 3).map((s) => (
            <li key={s}>
              <StatCard label={STATUS_LABEL[s]} value={count(s)} />
            </li>
          ))}
        {sla && (
          <li>
            <StatCard
              label="Past SLA"
              value={items.filter((c) => sla.get(c.id)?.state === "BREACHED").length}
              note={`${items.filter((c) => sla.get(c.id)?.state === "AT_RISK").length} at risk (2 business hours or less)`}
            />
          </li>
        )}
        {staffRole === "APPROVER" && (
          <li>
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
      <CaseTable cases={shown} empty={empty} onPick={onPick} busyId={pickingId} sla={sla} />
    </>
  );
}
