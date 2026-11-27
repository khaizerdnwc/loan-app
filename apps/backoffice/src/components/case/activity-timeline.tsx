"use client";

import { type ActivityView, ROLE_LABEL } from "@loan/core";
import { Card, formatAmountsInText, formatDateTime, StagePill } from "@loan/ui";
import { useEffect, useRef } from "react";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

/**
 * Who did what and when, newest first (PRD LND-WF-011). Reloads when the case's version
 * changes, i.e. after any action on it.
 */
export function ActivityTimeline({ caseId, version }: { caseId: string; version: number }) {
  const activity = useApi<ActivityView[]>(`/cases/${caseId}/activity`);
  const { reload } = activity;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void reload();
  }, [version, reload]);
  return (
    <Card title="Activity history">
      <LoadState
        loading={activity.loading && !activity.data}
        error={activity.error}
        onRetry={activity.reload}
      />
      {activity.data && activity.data.length === 0 && <p className="text-sm">No activity yet.</p>}
      {activity.data && activity.data.length > 0 && (
        // The prototype's .hist: a dot per event on a thin line, who and what, then when.
        // Summaries are written by the API; their amounts go through formatPeso here.
        <ol className="flex flex-col">
          {[...activity.data]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((event) => (
              <li
                key={event.id}
                className="relative pb-4 pl-5 before:absolute before:top-1.5 before:left-1 before:size-2 before:rounded-full before:bg-ink-700 after:absolute after:top-5 after:bottom-0 after:left-[7.5px] after:w-px after:bg-line last:pb-0 last:after:hidden"
              >
                <p className="text-sm">
                  <strong className="text-ink-900">{event.actorName}</strong>{" "}
                  <span className="text-xs text-mist-500">
                    {event.actorRole === "SYSTEM" ? "System" : ROLE_LABEL[event.actorRole]}
                  </span>
                </p>
                <p className="text-sm text-ink-800">{formatAmountsInText(event.summary)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mist-500">
                  <span>{formatDateTime(event.createdAt)}</span>
                  {event.toStatus && (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {event.fromStatus && <StagePill status={event.fromStatus} />}
                      <span aria-hidden="true">→</span>
                      <span className="sr-only">to</span>
                      <StagePill status={event.toStatus} />
                    </span>
                  )}
                </p>
              </li>
            ))}
        </ol>
      )}
    </Card>
  );
}
