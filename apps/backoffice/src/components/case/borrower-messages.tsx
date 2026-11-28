"use client";

import { type BorrowerMessageView, DELIVERY_STATUS_LABEL, type DeliveryStatus } from "@loan/core";
import { Card, EmptyState, formatDateTime, Pill, SimulatedLabel, type Tone } from "@loan/ui";
import { useEffect, useRef } from "react";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

const TONE: Record<DeliveryStatus, Tone> = { PENDING: "warn", SENT: "ok", FAILED: "bad" };

/**
 * The messages to the borrower and what became of them (PRD NTF-001, NTF-003): one line each,
 * newest first. The gateway is simulated, so nothing reaches a real person. Reloads after any
 * action on the case. A message the gateway could not take says why and that the case does
 * not wait for it.
 */
export function BorrowerMessages({ caseId, version }: { caseId: string; version: number }) {
  const messages = useApi<BorrowerMessageView[]>(`/notifications/cases/${caseId}`);
  const { reload } = messages;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void reload();
  }, [version, reload]);
  return (
    <Card title="Messages to the borrower" aside={<SimulatedLabel what="email and SMS" />}>
      <LoadState
        loading={messages.loading && !messages.data}
        error={messages.error}
        onRetry={messages.reload}
      />
      {messages.data && messages.data.length === 0 && (
        <EmptyState
          title="No messages to the borrower yet."
          hint="A decision, a request for documents or a disbursement sends one."
        />
      )}
      {messages.data && messages.data.length > 0 && (
        <ul aria-label="Messages to the borrower" className="flex flex-col gap-3">
          {messages.data.map((m) => (
            <li key={m.id} className="border-b border-line pb-3 text-sm last:border-b-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <Pill tone={TONE[m.status]}>{DELIVERY_STATUS_LABEL[m.status]}</Pill>
                <strong className="text-ink-900">{m.subject}</strong>
              </p>
              <p className="mt-1">{m.body}</p>
              <p className="mt-1 text-xs text-mist-500">
                {m.channel === "EMAIL" ? "Email" : "SMS"} · {m.recipient} ·{" "}
                {m.sentAt
                  ? `sent ${formatDateTime(m.sentAt)}`
                  : `queued ${formatDateTime(m.createdAt)}`}
                {m.attempts > 1 && ` · ${m.attempts} attempts`}
                {m.providerReference && (
                  <>
                    {" "}
                    · <span className="font-mono">{m.providerReference}</span>
                  </>
                )}
              </p>
              {m.lastError && m.status !== "SENT" && (
                <p className="mt-1 text-xs text-bad-700">
                  {m.lastError}{" "}
                  {m.status === "PENDING"
                    ? "It will be tried again shortly; the case does not wait for it."
                    : `Not sent after ${m.attempts} attempts. No more attempts will be made and the case is not affected; contact the borrower another way if they need this.`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
