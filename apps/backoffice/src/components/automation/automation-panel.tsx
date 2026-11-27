"use client";

import {
  AUTOMATION_MODE_LABEL,
  AUTOMATION_MODES,
  type AutomationAction,
  type AutomationActionAvailability,
  type AutomationMode,
  type AutomationView,
} from "@loan/core";
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
  Select,
  Textarea,
  type Tone,
  useToast,
} from "@loan/ui";
import { type ReactNode, useState } from "react";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";

const MODE_TONE: Record<AutomationMode, Tone> = { LIVE: "ok", SHADOW: "warn", OFF: "warn" };

/** What each mode does to the next application, so the drafter can predict it. */
const MODE_EFFECT: Record<AutomationMode, string> = {
  LIVE: "The engine's outcome moves the case: auto-approve, refer or auto-decline.",
  SHADOW:
    "The engine still decides and its outcome is recorded, but every case goes to a loan officer, who decides.",
  OFF: "Every application goes to a loan officer. The engine's score and reasons are shown to help them.",
};

type Dialog =
  | { kind: "mode"; view: AutomationView; mode: AutomationMode }
  | { kind: "killOn"; view: AutomationView }
  | { kind: "killOff"; view: AutomationView }
  | { kind: "approve"; view: AutomationView }
  | { kind: "reject"; view: AutomationView }
  | { kind: "withdraw"; view: AutomationView }
  | null;

/** The API action each dialog performs: after a refusal, the dialog stays only if still listed. */
const DIALOG_ACTION: Record<Exclude<Dialog, null>["kind"], AutomationAction> = {
  mode: "REQUEST_MODE_CHANGE",
  killOn: "KILL_SWITCH_ON",
  killOff: "REQUEST_KILL_SWITCH_OFF",
  approve: "APPROVE_CHANGE",
  reject: "REJECT_CHANGE",
  withdraw: "WITHDRAW_CHANGE",
};

function find(view: AutomationView, action: AutomationAction) {
  return view.allowedActions.find((a) => a.action === action);
}

/** A reason the API gave for an action being unavailable, in words (never a tooltip). */
function Blocked({ availability }: { availability: AutomationActionAvailability | undefined }) {
  if (!availability || availability.enabled) return null;
  return <p className="mt-1 text-xs text-bad-700">{availability.detail}</p>;
}

/**
 * The automation controls for each product (prototype: Configuration › AI models ›
 * Automation controls). It offers only what the API lists in `allowedActions`, disabled with
 * the API's reason where a rule refuses it now; maker-checker is decided by the API.
 */
export function AutomationPanel({
  views,
  onChanged,
}: {
  views: AutomationView[];
  onChanged: (next: AutomationView[]) => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  /** The mode chosen in each product's select, before "Draft change…" opens the dialog. */
  const [chosen, setChosen] = useState<Record<string, AutomationMode>>({});
  /** A refusal whose dialog closed because the refreshed product no longer offers the action. */
  const [cardError, setCardError] = useState<{ product: string; message: string } | null>(null);

  function open(next: Dialog) {
    setDialog(next);
    setText("");
    setError(null);
    setFieldError(undefined);
    setCardError(null);
  }

  /**
   * After a refusal, re-read the products: someone else may have acted. The dialog stays open
   * with the error only while its action is still offered; otherwise it closes and the error
   * moves onto the product's card.
   */
  async function followRefusal(d: Exclude<Dialog, null>, message: string) {
    let next: AutomationView[];
    try {
      next = await api<AutomationView[]>("/automation");
    } catch {
      setError(`${message} Reload the page to see the current state.`);
      return;
    }
    onChanged(next);
    const fresh = next.find((v) => v.productCode === d.view.productCode);
    const still = fresh?.allowedActions.find((a) => a.action === DIALOG_ACTION[d.kind]);
    // A mode change someone else already made leaves nothing to draft: close it too.
    const alreadyThere = d.kind === "mode" && fresh?.mode === d.mode;
    if (fresh && still?.enabled && !alreadyThere) {
      setDialog({ ...d, view: fresh });
      setError(message);
    } else {
      setDialog(null);
      setCardError({ product: d.view.productCode, message });
    }
  }

  async function confirm() {
    if (!dialog) return;
    const { view } = dialog;
    const base = `/automation/${view.productCode}`;
    const reasonNeeded =
      dialog.kind === "mode" || dialog.kind === "killOn" || dialog.kind === "killOff";
    if (reasonNeeded && !text.trim()) {
      setFieldError("Enter a reason.");
      return;
    }
    const call: Record<Exclude<Dialog, null>["kind"], () => Promise<AutomationView[]>> = {
      mode: () =>
        api(`${base}/changes`, {
          method: "POST",
          body: {
            kind: "SET_MODE",
            mode: dialog.kind === "mode" ? dialog.mode : undefined,
            reason: text,
          },
        }),
      killOn: () => api(`${base}/kill-switch`, { method: "POST", body: { reason: text } }),
      killOff: () =>
        api(`${base}/changes`, { method: "POST", body: { kind: "KILL_SWITCH_OFF", reason: text } }),
      approve: () =>
        api(`${base}/changes/${view.pendingChange?.id}/approve`, {
          method: "POST",
          body: text.trim() ? { note: text } : {},
        }),
      reject: () =>
        api(`${base}/changes/${view.pendingChange?.id}/reject`, {
          method: "POST",
          body: text.trim() ? { note: text } : {},
        }),
      // Withdrawing your own request is the same call; the API records it as withdrawn.
      withdraw: () =>
        api(`${base}/changes/${view.pendingChange?.id}/reject`, {
          method: "POST",
          body: text.trim() ? { note: text } : {},
        }),
    };
    const done: Record<Exclude<Dialog, null>["kind"], string> = {
      mode: "Change drafted — waiting for a second administrator",
      killOn: "Kill switch on — new applications go to manual review",
      killOff: "Request drafted — waiting for a second administrator",
      approve: "Change approved and in effect",
      reject: "Request rejected — nothing changed",
      withdraw: "Request withdrawn — nothing changed",
    };
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      const next = await call[dialog.kind]();
      toast(done[dialog.kind], dialog.kind === "killOn" ? "warn" : "ok");
      setDialog(null);
      setChosen({});
      onChanged(next);
    } catch (e) {
      const fields = fieldErrorsOf(e);
      if (fields.reason || fields.note) {
        // A problem with what was typed: keep the dialog as it is.
        setError(errorMessage(e));
        setFieldError(fields.reason ?? fields.note);
      } else {
        await followRefusal(dialog, errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {views.map((view) => {
        const modeAction = find(view, "REQUEST_MODE_CHANGE");
        const killOn = find(view, "KILL_SWITCH_ON");
        const killOff = find(view, "REQUEST_KILL_SWITCH_OFF");
        const approve = find(view, "APPROVE_CHANGE");
        const reject = find(view, "REJECT_CHANGE");
        const withdraw = find(view, "WITHDRAW_CHANGE");
        const pending = view.pendingChange;
        const selected = chosen[view.productCode] ?? view.mode;
        return (
          <Card key={view.productCode} title={`${view.productName} automation`}>
            {cardError?.product === view.productCode && (
              <Callout tone="bad" alert className="mb-4">
                {cardError.message}
              </Callout>
            )}
            <KeyValues
              items={[
                {
                  label: "Mode",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <Pill tone={view.killSwitch ? "bad" : MODE_TONE[view.mode]}>
                        {view.killSwitch ? "Kill switch on" : AUTOMATION_MODE_LABEL[view.mode]}
                      </Pill>
                      {view.killSwitch && (
                        <span className="text-xs text-mist-500">
                          Mode underneath: {AUTOMATION_MODE_LABEL[view.mode]}
                        </span>
                      )}
                    </span>
                  ),
                },
                ...(view.killSwitch && view.killSwitchSetByName && view.killSwitchSetAt
                  ? [
                      {
                        label: "Kill switch",
                        value: `Turned on by ${view.killSwitchSetByName}, ${formatDateTime(view.killSwitchSetAt)}`,
                      },
                    ]
                  : []),
              ]}
            />
            <p className="mt-3 text-sm">
              {view.killSwitch
                ? "Every new application goes to manual review until the kill switch is turned off."
                : MODE_EFFECT[view.mode]}
            </p>

            {pending && (
              <Callout tone="warn" className="mt-5" lead="Waiting for approval:">
                <span>
                  {pending.kind === "SET_MODE" && pending.requestedMode
                    ? `change from ${AUTOMATION_MODE_LABEL[pending.fromMode]} to ${AUTOMATION_MODE_LABEL[pending.requestedMode]}`
                    : "turn the kill switch off"}
                  , drafted by {pending.requestedByName} ({formatDateTime(pending.requestedAt)}).
                </span>
                <p className="mt-1">Reason: {pending.reason}</p>
                {(approve || reject || withdraw) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {approve && (
                      <Button
                        variant="primary"
                        disabled={!approve.enabled}
                        onClick={() => open({ kind: "approve", view })}
                      >
                        Approve change
                      </Button>
                    )}
                    {reject && (
                      <Button variant="secondary" onClick={() => open({ kind: "reject", view })}>
                        Reject change
                      </Button>
                    )}
                    {withdraw && (
                      <Button variant="secondary" onClick={() => open({ kind: "withdraw", view })}>
                        Withdraw request
                      </Button>
                    )}
                  </div>
                )}
                <Blocked availability={approve} />
              </Callout>
            )}

            {modeAction && (
              <div className="mt-5 max-w-sm">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-48 flex-1">
                    <Field label={`Change mode for ${view.productName}`}>
                      <Select
                        value={selected}
                        disabled={!modeAction.enabled}
                        onChange={(e) =>
                          setChosen((c) => ({
                            ...c,
                            [view.productCode]: e.target.value as AutomationMode,
                          }))
                        }
                      >
                        {AUTOMATION_MODES.map((m) => (
                          <option key={m} value={m}>
                            {AUTOMATION_MODE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Button
                    variant="primary"
                    disabled={!modeAction.enabled || selected === view.mode}
                    onClick={() => open({ kind: "mode", view, mode: selected })}
                  >
                    Draft change…
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-mist-500">
                  A change takes effect only when a second administrator approves it.
                </p>
                <Blocked availability={modeAction} />
              </div>
            )}

            {(killOn || killOff) && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
                <div className="min-w-56 flex-1 text-sm">
                  <strong className="text-ink-900">Kill switch</strong>
                  <p className="text-mist-500">
                    Sends every new application to manual review immediately.
                  </p>
                </div>
                {killOn && (
                  <Button variant="danger" onClick={() => open({ kind: "killOn", view })}>
                    Turn kill switch on
                  </Button>
                )}
                {killOff && (
                  <Button
                    variant="primary"
                    disabled={!killOff.enabled}
                    onClick={() => open({ kind: "killOff", view })}
                  >
                    Request kill switch off
                  </Button>
                )}
                <Blocked availability={killOff} />
              </div>
            )}

            {view.allowedActions.length === 0 && (
              <p className="mt-5 text-xs text-mist-500">
                Only an administrator can change automation.
              </p>
            )}
          </Card>
        );
      })}

      <ConfirmDialog
        open={dialog !== null}
        title={dialog ? titleOf(dialog) : ""}
        description={dialog ? describeDialog(dialog) : ""}
        confirmLabel={dialog ? CONFIRM[dialog.kind] : ""}
        variant={dialog?.kind === "killOn" ? "danger" : "primary"}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      >
        {dialog && (
          <FormStack>
            <Field
              label={
                dialog.kind === "approve" || dialog.kind === "reject" || dialog.kind === "withdraw"
                  ? "Note (optional)"
                  : "Reason"
              }
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
  mode: "Draft change",
  killOn: "Turn on",
  killOff: "Draft request",
  approve: "Approve change",
  reject: "Reject change",
  withdraw: "Withdraw request",
};

function titleOf(d: Exclude<Dialog, null>): string {
  const name = d.view.productName;
  switch (d.kind) {
    case "mode":
      return `Draft a change of ${name} to “${AUTOMATION_MODE_LABEL[d.mode]}”?`;
    case "killOn":
      return `Turn on the ${name} kill switch?`;
    case "killOff":
      return `Ask to turn the ${name} kill switch off?`;
    case "approve":
      return "Approve this change?";
    case "reject":
      return "Reject this change?";
    case "withdraw":
      return "Withdraw your request?";
  }
}

function describeDialog(d: Exclude<Dialog, null>): ReactNode {
  const p = d.view.pendingChange;
  switch (d.kind) {
    case "mode":
      return `${MODE_EFFECT[d.mode]} Nothing changes until a second administrator approves it.`;
    case "killOn":
      return "Every new application goes to manual review at once, until two administrators turn it off. Applications already decided are not affected.";
    case "killOff":
      return `Automated decisions resume in ${AUTOMATION_MODE_LABEL[d.view.mode].toLowerCase()} once a second administrator approves.`;
    case "approve":
      return p?.kind === "SET_MODE" && p.requestedMode
        ? `${d.view.productName} changes from ${AUTOMATION_MODE_LABEL[p.fromMode]} to ${AUTOMATION_MODE_LABEL[p.requestedMode]} now. ${MODE_EFFECT[p.requestedMode]}`
        : `The kill switch turns off now; automated decisions resume in ${AUTOMATION_MODE_LABEL[d.view.mode].toLowerCase()}.`;
    case "reject":
    case "withdraw":
      return `${d.view.productName} stays as it is. The request is kept in the history.`;
  }
}
