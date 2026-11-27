"use client";

import { type CaseDetail, CONSENT_TERMS_VERSION } from "@loan/core";
import { Button, Card, Checkbox, formatDateTime, useToast } from "@loan/ui";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { CONSENT_LABEL } from "@/lib/consent";

/**
 * The application's consent: what was agreed, under which terms, who captured it and when.
 * On a draft the loan officer can record or correct it here (a new record each time; the
 * latest applies). The API decides; submitting stays disabled until it is complete.
 */
export function ConsentPanel({
  detail: c,
  onChanged,
}: {
  detail: CaseDetail;
  onChanged: (next: CaseDetail) => void;
}) {
  const toast = useToast();
  const consent = c.consent;
  const canEdit = c.allowedActions.some((a) => a.action === "EDIT_DRAFT" && a.enabled);
  const [bureau, setBureau] = useState(consent?.creditBureauCheck ?? false);
  const [processing, setProcessing] = useState(consent?.dataProcessing ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<CaseDetail>(`/cases/${c.id}`, {
        method: "PATCH",
        body: {
          consent: {
            creditBureauCheck: bureau,
            dataProcessing: processing,
            termsVersion: CONSENT_TERMS_VERSION,
          },
        },
      });
      toast(
        next.consent?.complete
          ? "Consent recorded"
          : `Recorded: no consent to ${[
              bureau ? null : "the credit bureau check",
              processing ? null : "data processing",
            ]
              .filter(Boolean)
              .join(" or ")}`,
        next.consent?.complete ? "ok" : "warn",
      );
      onChanged(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const missing = [
    consent?.creditBureauCheck ? null : "credit bureau check",
    consent?.dataProcessing ? null : "data processing",
  ].filter(Boolean);

  return (
    <Card title="Consent" aside={`Terms ${CONSENT_TERMS_VERSION}`}>
      {consent ? (
        <p className="text-sm">
          {consent.complete ? (
            <strong className="text-ok-700">Complete.</strong>
          ) : missing.length ? (
            <strong className="text-bad-700">
              Incomplete: no consent to {missing.join(" or ")}.
            </strong>
          ) : (
            <strong className="text-bad-700">
              Incomplete: given under terms {consent.termsVersion}; record it again under terms{" "}
              {CONSENT_TERMS_VERSION}.
            </strong>
          )}{" "}
          Captured by {consent.capturedByName} at the branch, {formatDateTime(consent.capturedAt)},
          terms {consent.termsVersion}.
        </p>
      ) : (
        <p className="text-sm">
          <strong className="text-bad-700">Not recorded.</strong>{" "}
          {c.status === "DRAFT"
            ? "The application cannot be submitted until the applicant consents."
            : "This case cannot be decided again without it."}
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-col gap-2.5">
          <Checkbox
            label={CONSENT_LABEL.creditBureauCheck}
            checked={bureau}
            onChange={(e) => setBureau(e.target.checked)}
          />
          <Checkbox
            label={CONSENT_LABEL.dataProcessing}
            checked={processing}
            onChange={(e) => setProcessing(e.target.checked)}
          />
          {error && (
            <p role="alert" className="text-xs font-semibold text-bad-700">
              {error}
            </p>
          )}
          <div>
            <Button variant="secondary" busy={busy} onClick={save}>
              Record consent
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
