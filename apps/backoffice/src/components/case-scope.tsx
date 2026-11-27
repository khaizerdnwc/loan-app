"use client";

import { type CaseStatus, type CaseSummary, CLOSED_CASE_STATUSES } from "@loan/core";
import { SegmentedFilter } from "@loan/ui";

/** The prototype's All applications tabs: in progress, closed, or everything. */
export type CaseScope = "open" | "closed" | "all";

/** The scope named in the URL's `?scope=`; anything else means in progress. */
export function parseScope(value: string | null): CaseScope {
  return value === "closed" || value === "all" ? value : "open";
}

/** Whether a case belongs in a scope; closed is core's CLOSED_CASE_STATUSES. */
export function inScope(status: CaseStatus, scope: CaseScope): boolean {
  if (scope === "all") return true;
  const closed = CLOSED_CASE_STATUSES.includes(status);
  return scope === "closed" ? closed : !closed;
}

/** In progress / Closed / All, each with its count, as one segmented filter. */
export function CaseScopeFilter({
  items,
  value,
  onChange,
}: {
  items: CaseSummary[];
  value: CaseScope;
  onChange: (scope: CaseScope) => void;
}) {
  const count = (scope: CaseScope) => items.filter((c) => inScope(c.status, scope)).length;
  return (
    <SegmentedFilter
      label="Show applications"
      value={value}
      onChange={onChange}
      options={[
        { value: "open" as const, label: "In progress", count: count("open") },
        { value: "closed" as const, label: "Closed", count: count("closed") },
        { value: "all" as const, label: "All", count: count("all") },
      ]}
    />
  );
}
