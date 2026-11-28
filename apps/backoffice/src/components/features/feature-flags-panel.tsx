"use client";

import type { FeatureFlag, FeatureFlagView } from "@loan/core";
import {
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Field,
  FormStack,
  formatDateTime,
  KeyValues,
  Pill,
  Textarea,
  useToast,
} from "@loan/ui";
import { type ReactNode, useState } from "react";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";

/** What each module does when it is on, and what switching it off removes. */
const EFFECT: Record<FeatureFlag, { on: string; off: string }> = {
  ELIGIBILITY_PRECHECK: {
    on: "Loan officers can check a customer's stated figures against the policy before applying.",
    off: "The pre-check is hidden from loan officers and the API refuses it.",
  },
  EMAIL_INTAKE: {
    on: "Loan officers upload emailed and scanned applications, read by simulated OCR into drafts for review.",
    off: "Email and file intake is hidden from loan officers and compliance, and the API refuses it. Drafts already captured are kept.",
  },
};

type Dialog =
  | { kind: "request"; view: FeatureFlagView }
  | { kind: "approve"; view: FeatureFlagView }
  | { kind: "reject"; view: FeatureFlagView }
  | { kind: "withdraw"; view: FeatureFlagView }
  | null;

const onOff = (enabled: boolean) => (enabled ? "on" : "off");

/**
 * The bank's switchable modules (PRD PLT-006). It offers only what the API lists in
 * `allowedActions`; maker-checker and one pending change per flag are decided by the API, and a
 * refusal is shown as the API wrote it (including a field error with no input of its own, such
 * as the flag already being in the requested state).
 */
export function FeatureFlagsPanel({
  views,
  onChanged,
}: {
  views: FeatureFlagView[];
  onChanged: (next: FeatureFlagView[]) => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  function open(next: Dialog) {
    setDialog(next);
    setText("");
    setError(null);
    setFieldError(undefined);
  }

  async function confirm() {
    if (!dialog) return;
    const { view } = dialog;
    const base = `/features/flags/${view.key}/changes`;
    if (dialog.kind === "request" && !text.trim()) {
      setFieldError("Enter a reason.");
      return;
    }
    const note = text.trim() ? { note: text } : {};
    const decide = (verb: "approve" | "reject") => () =>
      api<FeatureFlagView[]>(`${base}/${view.pendingChange?.id}/${verb}`, {
        method: "POST",
        body: note,
      });
    const call = {
      request: () =>
        api<FeatureFlagView[]>(base, {
          method: "POST",
          body: { enabled: !view.enabled, reason: text },
        }),
      approve: decide("approve"),
      reject: decide("reject"),
      // Withdrawing your own request is the same call; the API records it as withdrawn.
      withdraw: decide("reject"),
    }[dialog.kind];
    const done = {
      request: "Change drafted — waiting for a second administrator",
      approve: `${view.label} switched ${onOff(view.pendingChange?.enabled ?? !view.enabled)}`,
      reject: "Request rejected — nothing changed",
      withdraw: "Request withdrawn — nothing changed",
    }[dialog.kind];
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      const next = await call();
      toast(done, "ok");
      setDialog(null);
      onChanged(next);
    } catch (e) {
      const fields = fieldErrorsOf(e);
      // The API's own words stay in the dialog's error, so a field error with no input here
      // (`enabled`) is still shown; a reason or note error also sits under its field.
      setError(fields.enabled ? `${errorMessage(e)} ${fields.enabled}` : errorMessage(e));
      setFieldError(fields.reason ?? fields.note);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {views.map((view) => {
        const pending = view.pendingChange;
        const own = pending !== null && view.allowedActions.approveBlockedReason !== null;
        return (
          <Card key={view.key} title={view.label} region>
            <KeyValues
              items={[
                {
                  label: "State",
                  value: (
                    <Pill tone={view.enabled ? "ok" : "warn"}>{view.enabled ? "On" : "Off"}</Pill>
                  ),
                },
                {
                  label: "Last changed",
                  value: view.updatedByName
                    ? `By ${view.updatedByName}, ${formatDateTime(view.updatedAt)}`
                    : "Not changed since set-up",
                },
              ]}
            />
            <p className="mt-3 text-sm">
              {view.enabled ? EFFECT[view.key].on : EFFECT[view.key].off}
            </p>

            {pending && (
              <Callout tone="warn" className="mt-5" lead="Waiting for approval:">
                <span>
                  switch {onOff(pending.enabled)}, drafted by {pending.requestedByName} (
                  {formatDateTime(pending.requestedAt)}).
                </span>
                <p className="mt-1">Reason: {pending.reason}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {view.allowedActions.approve && (
                    <Button variant="primary" onClick={() => open({ kind: "approve", view })}>
                      Approve change
                    </Button>
                  )}
                  {view.allowedActions.reject && !own && (
                    <Button variant="secondary" onClick={() => open({ kind: "reject", view })}>
                      Reject change
                    </Button>
                  )}
                  {view.allowedActions.reject && own && (
                    <Button variant="secondary" onClick={() => open({ kind: "withdraw", view })}>
                      Withdraw request
                    </Button>
                  )}
                </div>
                {view.allowedActions.approveBlockedReason && (
                  <p className="mt-1 text-xs text-mist-500">
                    {view.allowedActions.approveBlockedReason}
                  </p>
                )}
              </Callout>
            )}

            {view.allowedActions.request && (
              <div className="mt-5">
                <Button
                  variant={view.enabled ? "danger" : "primary"}
                  onClick={() => open({ kind: "request", view })}
                >
                  {view.enabled ? "Request switch off…" : "Request switch on…"}
                </Button>
                <p className="mt-1.5 text-xs text-mist-500">
                  A change takes effect only when a second administrator approves it.
                </p>
              </div>
            )}
          </Card>
        );
      })}

      <ConfirmDialog
        open={dialog !== null}
        title={dialog ? titleOf(dialog) : ""}
        description={dialog ? describeDialog(dialog) : ""}
        confirmLabel={dialog ? CONFIRM[dialog.kind] : ""}
        variant={dialog?.kind === "request" && dialog.view.enabled ? "danger" : "primary"}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      >
        {dialog && (
          <FormStack>
            <Field
              label={dialog.kind === "request" ? "Reason" : "Note (optional)"}
              error={fieldError}
            >
              <Textarea value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            </Field>
          </FormStack>
        )}
      </ConfirmDialog>
    </div>
  );
}

const CONFIRM: Record<Exclude<Dialog, null>["kind"], string> = {
  request: "Draft change",
  approve: "Approve change",
  reject: "Reject change",
  withdraw: "Withdraw request",
};

function titleOf(d: Exclude<Dialog, null>): string {
  switch (d.kind) {
    case "request":
      return `Ask to switch ${d.view.label} ${onOff(!d.view.enabled)}?`;
    case "approve":
      return `Switch ${d.view.label} ${onOff(d.view.pendingChange?.enabled ?? !d.view.enabled)} now?`;
    case "reject":
      return "Reject this change?";
    case "withdraw":
      return "Withdraw your request?";
  }
}

function describeDialog(d: Exclude<Dialog, null>): ReactNode {
  const target = d.kind === "request" ? !d.view.enabled : (d.view.pendingChange?.enabled ?? false);
  const effect = target ? EFFECT[d.view.key].on : EFFECT[d.view.key].off;
  switch (d.kind) {
    case "request":
      return `${effect} Nothing changes until a second administrator approves it.`;
    case "approve":
      return `${effect} It takes effect for everyone at once.`;
    case "reject":
    case "withdraw":
      return `${d.view.label} stays ${onOff(d.view.enabled)}. The request is kept in the audit log.`;
  }
}
