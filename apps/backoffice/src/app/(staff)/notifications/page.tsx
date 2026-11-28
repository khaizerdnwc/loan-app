"use client";

import type { StaffNotificationList, StaffNotificationView } from "@loan/core";
import { Button, Callout, Card, EmptyState, formatDateTime, Pill } from "@loan/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, useShellRefresh } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/**
 * Staff alerts (PRD NTF-002): work assigned to you, work waiting for your role, and cases past
 * their SLA, newest first. Marking one read changes nothing about the case; an alert sent to
 * your whole role is read for everyone in it.
 */
export default function NotificationsPage() {
  const loaded = useApi<StaffNotificationList>("/notifications");
  const [list, setList] = useState<StaffNotificationList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshShell = useShellRefresh();

  useEffect(() => {
    if (loaded.data) setList(loaded.data);
  }, [loaded.data]);

  async function markRead(n: StaffNotificationView) {
    setBusy(n.id);
    setError(null);
    try {
      const next = await api<StaffNotificationView>(`/notifications/${n.id}/read`, {
        method: "POST",
      });
      setList((l) =>
        l
          ? {
              items: l.items.map((x) => (x.id === next.id ? next : x)),
              unread: Math.max(0, l.unread - (n.readAt ? 0 : 1)),
            }
          : l,
      );
      // The sidebar's unread badge follows.
      refreshShell();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Work assigned to you, work waiting for your role, and cases past their SLA. Alerts point at the case; the case is where you act."
      />
      {!list ? (
        <LoadState loading={loaded.loading} error={loaded.error} onRetry={loaded.reload} />
      ) : (
        <Card title="Alerts" aside={`${list.unread} unread`}>
          {error && (
            <Callout tone="bad" alert className="mb-3">
              {error}
            </Callout>
          )}
          {list.items.length === 0 ? (
            <EmptyState
              title="No alerts for you yet."
              hint="Work assigned to you, work waiting for your role and cases past their SLA show here."
            />
          ) : (
            <ul aria-label="Alerts" className="flex flex-col gap-3">
              {list.items.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3 text-sm last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      {!n.readAt && <Pill tone="info">New</Pill>}
                      {n.kind === "SLA_BREACHED" && <Pill tone="bad">Past SLA</Pill>}
                      <span className="font-semibold text-ink-900">{n.title}</span>
                    </p>
                    <p className="mt-1 text-xs text-mist-500">
                      {formatDateTime(n.createdAt)} ·{" "}
                      {n.forRole ? "for everyone in your role" : "for you"}
                      {n.readAt && n.forRole && (
                        <>
                          {" "}
                          · read by {n.readByName ?? "a colleague"} {formatDateTime(n.readAt)}
                        </>
                      )}
                      {n.caseId && n.caseReference && (
                        <>
                          {" "}
                          ·{" "}
                          <Link
                            href={`/cases/${n.caseId}`}
                            className="font-mono underline-offset-2 hover:underline"
                          >
                            {n.caseReference}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  {!n.readAt && (
                    <Button
                      size="sm"
                      variant="secondary"
                      busy={busy === n.id}
                      onClick={() => void markRead(n)}
                      aria-label={
                        n.forRole
                          ? `Mark "${n.title}" read for your role`
                          : `Mark "${n.title}" read`
                      }
                    >
                      {n.forRole ? "Mark read for your role" : "Mark read"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
