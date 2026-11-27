"use client";

import { type ActivityView, ROLE_LABEL } from "@loan/core";
import { Card, formatDateTime, StagePill } from "@loan/ui";
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
        <ol className="flex flex-col gap-4">
          {[...activity.data]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((event) => (
              <li key={event.id} className="border-l-2 border-gold-200 pl-4">
                <p className="text-sm">
                  <strong className="text-ink-900">{event.actorName}</strong>{" "}
                  <span className="text-xs text-mist-500">
                    {event.actorRole === "SYSTEM" ? "System" : ROLE_LABEL[event.actorRole]}
                  </span>
                </p>
                <p className="text-sm text-ink-800">{event.summary}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mist-500">
                  {formatDateTime(event.createdAt)}
                  {event.toStatus && (
                    <>
                      {event.fromStatus && <StagePill status={event.fromStatus} />}
                      <span aria-hidden="true">→</span>
                      <StagePill status={event.toStatus} />
                    </>
                  )}
                </p>
              </li>
            ))}
        </ol>
      )}
    </Card>
  );
}
