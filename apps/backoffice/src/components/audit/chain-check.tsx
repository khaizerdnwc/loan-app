"use client";

import type { AuditChainVerification } from "@loan/core";
import { Button, Callout, Card, formatDateTime, formatNumber, Pill } from "@loan/ui";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

/**
 * Tamper evidence (PRD CMP-010): each entry's hash covers the entry before it, so the API can
 * recompute the whole chain and name the first entry that was changed or removed. Read-only.
 */
export function ChainCheck() {
  const [result, setResult] = useState<AuditChainVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<AuditChainVerification>("/audit/verify"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Tamper evidence">
      <p className="text-sm">
        Every entry stores a SHA-256 hash of itself and the entry before it. Entries cannot be
        edited or deleted; verifying recomputes every hash from the first entry.
      </p>
      <div className="mt-4">
        <Button variant="secondary" busy={busy} onClick={verify}>
          Verify the chain
        </Button>
      </div>
      {error && (
        <Callout tone="bad" alert className="mt-3">
          {error}
        </Callout>
      )}
      {result && (
        <div aria-live="polite" className="mt-4 flex flex-col gap-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            {result.intact ? (
              <Pill tone="ok">Chain intact</Pill>
            ) : (
              <Pill tone="bad">Chain broken</Pill>
            )}
            {formatNumber(result.checked)} entries checked · {formatDateTime(result.verifiedAt)}
          </p>
          {!result.intact && result.problem && (
            <p className="text-bad-700">
              First problem at entry {result.firstBrokenSeq}: {result.problem}.
            </p>
          )}
          {result.headHash && (
            <p className="text-xs text-mist-500">
              Latest entry {result.headSeq} ·{" "}
              <span className="font-mono break-all">{result.headHash}</span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
