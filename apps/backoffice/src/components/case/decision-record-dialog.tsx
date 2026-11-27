"use client";

import type { DecisionRecordView, ReproduceResult } from "@loan/core";
import { Button, formatDateTime, Modal, Pill } from "@loan/ui";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

/**
 * The stored decision record (ADR 0022): versions, the input hash, the inputs themselves, and
 * a Reproduce button that re-runs the stored inputs and reports whether the result matches.
 * Reproducing changes nothing, so every role that can see the case may run it.
 */
export function DecisionRecordDialog({
  decision,
  open,
  canReproduce,
  onClose,
}: {
  decision: DecisionRecordView;
  open: boolean;
  canReproduce: boolean;
  onClose: () => void;
}) {
  const [result, setResult] = useState<ReproduceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reproduce() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<ReproduceResult>(`/decisions/${decision.id}/reproduce`, { method: "POST" }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Decision record"
      description="Insert-only. The inputs and the rule set and scorecard versions are stored, so the decision can be reproduced later."
      onClose={onClose}
      footer={
        <>
          {canReproduce && (
            <Button variant="primary" busy={busy} onClick={reproduce}>
              Reproduce
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-mist-500">decision_id</dt>
        <dd className="break-all text-ink-900">{decision.id}</dd>
        <dt className="text-mist-500">outcome</dt>
        <dd className="text-ink-900">{decision.outcome}</dd>
        <dt className="text-mist-500">score / grade</dt>
        <dd className="text-ink-900">
          {decision.score ?? "—"} / {decision.grade ?? "—"}
        </dd>
        <dt className="text-mist-500">rule_set</dt>
        <dd className="text-ink-900">{decision.ruleSetVersion}</dd>
        <dt className="text-mist-500">scorecard</dt>
        <dd className="text-ink-900">{decision.scorecardVersion}</dd>
        <dt className="text-mist-500">provider_mode</dt>
        <dd className="text-ink-900">{decision.providerMode}</dd>
        <dt className="text-mist-500">inputs_hash</dt>
        <dd className="break-all text-ink-900">{decision.inputsHash}</dd>
        <dt className="text-mist-500">recorded_at</dt>
        <dd className="text-ink-900">{formatDateTime(decision.createdAt)}</dd>
      </dl>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink-800">
          Inputs snapshot
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-btn bg-mist-050 p-3 font-mono text-2xs text-ink-800">
          {JSON.stringify(decision.inputs, null, 2)}
        </pre>
      </details>
      {result && (
        <div role="status" className="mt-4 rounded-btn border border-line px-4 py-3 text-sm">
          {result.match && result.inputsHashMatches ? (
            <p className="flex items-center gap-2">
              <Pill tone="ok">Match</Pill> Re-running the stored inputs with{" "}
              {decision.ruleSetVersion} and {decision.scorecardVersion} gives the same result.
            </p>
          ) : (
            <div>
              <p className="flex items-center gap-2">
                <Pill tone="bad">Mismatch</Pill>
                {!result.inputsHashMatches && "The stored inputs no longer match their hash."}
              </p>
              {result.differences.length > 0 && (
                <ul className="mt-2 list-disc pl-5 font-mono text-xs">
                  {result.differences.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-btn bg-bad-050 px-3 py-2 text-sm text-bad-700">
          {error}
        </p>
      )}
    </Modal>
  );
}
