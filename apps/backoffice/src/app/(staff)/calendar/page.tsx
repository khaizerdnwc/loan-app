"use client";

import type { BusinessCalendarView } from "@loan/core";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { BusinessCalendarPanel } from "@/components/calendar/business-calendar-panel";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

/**
 * The business calendar (PRD PLT-005): the holidays the business clock skips for stage SLAs
 * and turnaround. Administrators draft adding or removing a future holiday and a second
 * administrator approves it; each step is in the audit log.
 */
export default function CalendarPage() {
  const calendar = useApi<BusinessCalendarView>("/calendar");
  const [view, setView] = useState<BusinessCalendarView | null>(null);

  useEffect(() => {
    if (calendar.data) setView(calendar.data);
  }, [calendar.data]);

  return (
    <>
      <PageHeader
        title="Business calendar"
        description="The holidays the business clock skips when it measures SLAs and turnaround. Only days after today can change; each change is drafted by one administrator and approved by another."
      />
      <LoadState
        loading={calendar.loading && !view}
        error={calendar.error}
        onRetry={calendar.reload}
      />
      {view && (
        <div className="max-w-3xl">
          <BusinessCalendarPanel view={view} onChanged={setView} />
        </div>
      )}
    </>
  );
}
