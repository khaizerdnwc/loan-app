"use client";

import {
  type AmlEscalationView,
  ESCALATION_OUTCOME_LABEL,
  type EscalationOutcome,
  ProblemCode,
} from "@loan/core";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  FormStack,
  Select,
  Textarea,
  useToast,
} from "@loan/ui";
import { useState } from "react";
import { ApiError, api, errorMessage, fieldErrorsOf } from "@/lib/api";

const OUTCOME_EFFECT: Record<AmlEscalationView["stage"], Record<EscalationOutcome, string>> = {
  ONBOARDING: {
    FALSE_POSITIVE: "The application stays declined: the decision record does not change.",
    CONFIRMED_MATCH: "The application stays declined.",
  },
  PRE_DISBURSEMENT: {
    FALSE_POSITIVE:
      "Loan operations can retry the booking; this same match will not stop it again.",
    CONFIRMED_MATCH: "The booking stays blocked and the loan will not be booked.",
  },
};

/**
 * Compliance's two actions on an escalation, each confirmed first: acknowledge it (open →
 * acknowledged), and close it with an outcome and notes. The API decides; a refusal is shown
 * here in its own words. When a colleague acted first (409), the escalation is read again and
 * the dialog closes, so it never offers a step the escalation no longer allows.
 */
export function EscalationActions({
  escalation: e,
  onChanged,
}: {
  escalation: AmlEscalationView;
  onChanged: (next: AmlEscalationView) => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"acknowledge" | "close" | null>(null);
  const [outcome, setOutcome] = useState<EscalationOutcome>("FALSE_POSITIVE");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (e.status === "CLOSED") {
    return (
      <Card title="Closed">
        <p className="text-sm">
          {e.outcome ? `${ESCALATION_OUTCOME_LABEL[e.outcome]}. ` : ""}
          {e.effect}
        </p>
        <p className="mt-2 text-xs text-mist-500">Nothing left to do on this escalation.</p>
      </Card>
    );
  }

  function cancel() {
    setDialog(null);
    setError(null);
    setFieldErrors({});
  }

  async function run() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const next =
        dialog === "acknowledge"
          ? await api<AmlEscalationView>(`/compliance/escalations/${e.id}/acknowledge`, {
              method: "POST",
            })
          : await api<AmlEscalationView>(`/compliance/escalations/${e.id}/close`, {
              method: "POST",
              body: { outcome, notes },
            });
      toast(dialog === "acknowledge" ? "Escalation acknowledged" : "Escalation closed", "ok");
      setDialog(null);
      onChanged(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === ProblemCode.InvalidTransition) {
        // Someone else moved it on: show its current state instead of a stale dialog.
        try {
          const current = await api<AmlEscalationView>(`/compliance/escalations/${e.id}`);
          setDialog(null);
          toast(errorMessage(err), "warn");
          onChanged(current);
          return;
        } catch {
          setError(`${errorMessage(err)} Reload the page to see the escalation's current state.`);
          return;
        }
      }
      setError(errorMessage(err));
      setFieldErrors(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card region title="Next action">
      <p className="text-sm">
        {e.status === "OPEN"
          ? "Waiting for Compliance: acknowledge the escalation, review the match, then close it with your notes."
          : "Acknowledged: close the escalation with an outcome and your notes once the review is done."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {e.status === "OPEN" && (
          <Button variant="secondary" onClick={() => setDialog("acknowledge")}>
            Acknowledge
          </Button>
        )}
        <Button variant="primary" onClick={() => setDialog("close")}>
          Close escalation
        </Button>
      </div>

      <ConfirmDialog
        open={dialog === "acknowledge"}
        title={`Acknowledge the escalation for ${e.applicantName}?`}
        description={`Case ${e.caseReference}. It is recorded that you are reviewing this match; the case does not change.`}
        confirmLabel="Acknowledge"
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={cancel}
      />
      <ConfirmDialog
        open={dialog === "close"}
        title={`Close the escalation for ${e.applicantName}?`}
        description={`Case ${e.caseReference}. ${OUTCOME_EFFECT[e.stage][outcome]}`}
        confirmLabel="Close escalation"
        variant={outcome === "CONFIRMED_MATCH" ? "danger" : "primary"}
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={cancel}
      >
        <FormStack>
          <Field label="Outcome" error={fieldErrors.outcome}>
            <Select
              value={outcome}
              onChange={(ev) => setOutcome(ev.target.value as EscalationOutcome)}
            >
              {(Object.keys(ESCALATION_OUTCOME_LABEL) as EscalationOutcome[]).map((o) => (
                <option key={o} value={o}>
                  {ESCALATION_OUTCOME_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Closing notes"
            hint="What you checked and why you reached this outcome."
            error={fieldErrors.notes}
          >
            <Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} maxLength={2000} />
          </Field>
        </FormStack>
      </ConfirmDialog>
    </Card>
  );
}
