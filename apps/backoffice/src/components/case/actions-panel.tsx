"use client";

import {
  type ActionAvailability,
  type CaseAction,
  type CaseDetail,
  DECLINE_REASON_LABEL,
  type DeclineReason,
  type DeclineRequest,
  OVERRIDE_REASON_LABEL,
  type OverrideReason,
  type Recommendation,
  type RecommendRequest,
} from "@loan/core";
import { Button, Card, ConfirmDialog, Field, formatPeso, inputClass, useToast } from "@loan/ui";
import { type ReactNode, useState } from "react";
import { useShellRefresh } from "@/components/app-shell";
import { ApiError, api, errorMessage, fieldErrorsOf } from "@/lib/api";
import { MAX_AMOUNT, MIN_AMOUNT, toCentavos, toDecimalString } from "@/lib/application-schema";

interface SimpleAction {
  label: string;
  path: (id: string) => string;
  variant: "primary" | "accent" | "danger" | "secondary";
  title: (c: CaseDetail) => string;
  describe: (c: CaseDetail) => ReactNode;
  done: string;
}

const amountOf = (c: CaseDetail) =>
  c.approved?.amount ?? c.recommendation?.amount ?? c.requestedAmount;
const tenorOf = (c: CaseDetail) =>
  c.approved?.tenorMonths ?? c.recommendation?.tenorMonths ?? c.requestedTenorMonths;

/** Actions that post with no body. Each states what will happen before it runs. */
const SIMPLE: Partial<Record<CaseAction, SimpleAction>> = {
  SUBMIT: {
    label: "Submit for decision",
    path: (id) => `/cases/${id}/submit`,
    variant: "accent",
    title: () => "Submit this application for decision?",
    describe: (c) =>
      `${c.applicant.fullName} · ${formatPeso(c.requestedAmount)} over ${c.requestedTenorMonths} months. The checks and the decision run now.`,
    done: "Submitted for decision",
  },
  APPROVE: {
    label: "Approve",
    path: (id) => `/cases/${id}/approve`,
    variant: "primary",
    title: (c) => `Approve ${formatPeso(amountOf(c))} over ${tenorOf(c)} months?`,
    describe: (c) =>
      `${c.applicant.fullName} receives an offer on these terms. Your authority is checked by the system when you confirm.`,
    done: "Approved — the offer is ready for signature",
  },
  RETURN: {
    label: "Return to loan officer",
    path: (id) => `/cases/${id}/return`,
    variant: "secondary",
    title: () => "Return this case to the loan officer?",
    describe: () => "The case goes back to review; the recommendation stays on record.",
    done: "Returned to the loan officer",
  },
  SIGN: {
    label: "Record borrower e-signature",
    path: (id) => `/cases/${id}/sign`,
    variant: "primary",
    title: () => "Record the borrower's e-signature?",
    describe: (c) =>
      `The borrower side is simulated: the e-signature service signs the agreement for ${formatPeso(amountOf(c))} over ${tenorOf(c)} months at once, and the case moves to booking.`,
    done: "Signed — ready to book",
  },
  SUBMIT_BOOKING: {
    label: "Submit booking for checker",
    path: (id) => `/cases/${id}/booking`,
    variant: "primary",
    title: () => "Submit this booking for a checker?",
    describe: (c) =>
      `Books ${formatPeso(amountOf(c))} over ${tenorOf(c)} months in core banking once a loan operations supervisor (not you) approves it.`,
    done: "Submitted — waiting for a checker",
  },
  APPROVE_BOOKING: {
    label: "Approve booking",
    path: (id) => `/cases/${id}/booking/approve`,
    variant: "accent",
    title: () => "Approve this booking?",
    describe: (c) =>
      `Opens the loan account in core banking and disburses ${formatPeso(amountOf(c))} to ${c.applicant.depositAccount}. The booking key makes a repeat safe: it can never book twice.`,
    done: "Booked and disbursed",
  },
  RETRY_BOOKING: {
    label: "Retry booking",
    path: (id) => `/cases/${id}/booking/approve`,
    variant: "accent",
    title: () => "Retry this booking?",
    describe: (c) =>
      `Sends the same booking key again (${c.booking?.idempotencyKey ?? "—"}). If core banking already opened the account, the retry uses it instead of opening a second one.`,
    done: "Booking retried",
  },
};

type Open =
  | { kind: "simple"; action: CaseAction }
  | { kind: "recommend" }
  | { kind: "decline" }
  | null;

/**
 * The next-action card. It shows only what the API lists in `allowedActions` — enabled, or
 * disabled with the API's reason — so authority and maker-checker are never decided here.
 */
export function ActionsPanel({
  detail,
  onChanged,
  onShowDecision,
}: {
  detail: CaseDetail;
  onChanged: (next: CaseDetail) => void;
  onShowDecision: () => void;
}) {
  const toast = useToast();
  const refreshShell = useShellRefresh();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const actions = detail.allowedActions.filter((a) => a.action !== "EDIT_DRAFT");

  async function run(path: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const next = await api<CaseDetail>(path, { method: "POST", body });
      toast(done);
      setOpen(null);
      onChanged(next);
      refreshShell();
    } catch (e) {
      setError(errorMessage(e));
      setFieldErrors(fieldErrorsOf(e));
      // A refused approval above authority still escalates the case (R-6): show that.
      if (e instanceof ApiError && e.code === "AUTHORITY_LIMIT_EXCEEDED") {
        api<CaseDetail>(`/cases/${detail.id}`).then(onChanged, () => {});
        refreshShell();
      }
    } finally {
      setBusy(false);
    }
  }

  function start(a: ActionAvailability) {
    setError(null);
    setFieldErrors({});
    if (a.action === "REPRODUCE_DECISION") onShowDecision();
    else if (a.action === "RECOMMEND") setOpen({ kind: "recommend" });
    else if (a.action === "DECLINE") setOpen({ kind: "decline" });
    else setOpen({ kind: "simple", action: a.action });
  }

  const simple = open?.kind === "simple" ? SIMPLE[open.action] : undefined;

  return (
    <Card title="Next action">
      <p className="text-sm">{waitingFor(detail)}</p>
      {actions.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {actions.map((a) => (
            <li key={a.action}>
              <Button
                className="w-full"
                variant={a.enabled ? (SIMPLE[a.action]?.variant ?? "primary") : "secondary"}
                disabled={!a.enabled && !canAttempt(a)}
                aria-describedby={a.enabled ? undefined : `${a.action}-blocked`}
                onClick={() => start(a)}
              >
                {labelOf(a.action)}
              </Button>
              {!a.enabled && (
                <p id={`${a.action}-blocked`} className="mt-1 text-xs text-bad-700">
                  {a.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {simple && open?.kind === "simple" && (
        <ConfirmDialog
          open
          title={simple.title(detail)}
          description={simple.describe(detail)}
          confirmLabel={simple.label}
          variant={simple.variant === "secondary" ? "primary" : simple.variant}
          busy={busy}
          error={error}
          onConfirm={() => run(simple.path(detail.id), undefined, simple.done)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open?.kind === "recommend" && (
        <RecommendDialog
          detail={detail}
          busy={busy}
          error={error}
          fieldErrors={fieldErrors}
          onCancel={() => setOpen(null)}
          onSubmit={(body) =>
            run(`/cases/${detail.id}/recommendation`, body, "Recommendation sent to an approver")
          }
        />
      )}
      {open?.kind === "decline" && (
        <DeclineDialog
          detail={detail}
          busy={busy}
          error={error}
          fieldErrors={fieldErrors}
          onCancel={() => setOpen(null)}
          onSubmit={(body) =>
            run(`/cases/${detail.id}/decline`, body, "Declined — the borrower is told why")
          }
        />
      )}
    </Card>
  );
}

/**
 * An approval above the approver's authority stays clickable: the API refuses it with the
 * reason and escalates the case (PRD: "blocked or escalated"), which the approver should see
 * happen. Every other disabled action cannot be attempted.
 */
function canAttempt(a: ActionAvailability): boolean {
  return !a.enabled && a.action === "APPROVE" && a.blockedBy === "AUTHORITY_LIMIT_EXCEEDED";
}

function labelOf(action: CaseAction): string {
  if (action === "RECOMMEND") return "Recommend a decision";
  if (action === "DECLINE") return "Decline";
  if (action === "REPRODUCE_DECISION") return "View decision record";
  return SIMPLE[action]?.label ?? action;
}

/** What the case is waiting for and who acts next, in words. */
function waitingFor(c: CaseDetail): string {
  switch (c.status) {
    case "DRAFT":
      return "Draft: nothing has been checked yet. The loan officer submits it for decision.";
    case "REVIEW":
      return "Referred: a loan officer reviews the evidence and recommends a decision.";
    case "APPROVAL":
      return c.escalated
        ? "Waiting for an approver whose authority covers this amount and grade."
        : "Waiting for an approver to decide on the recommendation.";
    case "OFFER":
      return "Approved. Waiting for the borrower's e-signature (simulated), recorded by loan operations.";
    case "BOOKING":
      return "Signed. Loan operations submits the booking; a supervisor checks it.";
    case "PENDING_CHECKER":
      return "Waiting for a loan operations supervisor — not the person who submitted it — to approve the booking.";
    case "BOOKING_FAILED":
      return "The last booking attempt failed. A supervisor can retry it safely with the same booking key.";
    case "DISBURSED":
      return "Booked in core banking and disbursed. Nothing left to do.";
    case "DECLINED":
      return "Declined. The borrower is told why, without internal scores.";
    default:
      return "";
  }
}

function RecommendDialog({
  detail,
  busy,
  error,
  fieldErrors,
  onCancel,
  onSubmit,
}: {
  detail: CaseDetail;
  busy: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onCancel: () => void;
  onSubmit: (body: RecommendRequest) => void;
}) {
  const [type, setType] = useState<Recommendation>("APPROVE");
  const [amount, setAmount] = useState(detail.requestedAmount);
  const [tenor, setTenor] = useState(String(detail.requestedTenorMonths));
  const [reason, setReason] = useState<OverrideReason | "">("");
  const [rationale, setRationale] = useState("");
  const [local, setLocal] = useState<Record<string, string>>({});

  const centavos = toCentavos(amount);
  const amountProblem =
    centavos === null
      ? "Enter an amount in pesos, e.g. 120000."
      : centavos < (toCentavos(MIN_AMOUNT) ?? 0n) || centavos > (toCentavos(MAX_AMOUNT) ?? 0n)
        ? `The amount must be between ${formatPeso(MIN_AMOUNT)} and ${formatPeso(MAX_AMOUNT)}.`
        : null;
  const amountText = amountProblem ? "" : toDecimalString(amount);
  const tenorValid = /^\d+$/.test(tenor.trim());
  // Mirrors the API's rule so the officer is asked up front; the API still decides.
  const changesTerms =
    type === "DECLINE" ||
    (type === "COUNTER_OFFER" &&
      (amountText !== detail.requestedAmount ||
        tenor.trim() !== String(detail.requestedTenorMonths)));

  function submit() {
    const problems: Record<string, string> = {};
    if (type === "COUNTER_OFFER") {
      if (amountProblem) problems.amount = amountProblem;
      if (!tenorValid) problems.tenorMonths = "Enter a whole number of months.";
    }
    if (changesTerms && !reason)
      problems.overrideReason = "Choose a reason code: this differs from the application.";
    if (rationale.trim().length < 5)
      problems.rationale = "Write a short rationale for the approver.";
    setLocal(problems);
    if (Object.keys(problems).length) return;
    onSubmit({
      type,
      amount: type === "COUNTER_OFFER" ? amountText : undefined,
      tenorMonths: type === "COUNTER_OFFER" ? Number.parseInt(tenor, 10) : undefined,
      overrideReason: reason || undefined,
      rationale: rationale.trim(),
    });
  }

  const fieldError = (name: string) => local[name] ?? fieldErrors[name];
  const summary =
    type === "DECLINE"
      ? "Recommendation: decline."
      : type === "APPROVE"
        ? `Recommendation: approve ${formatPeso(detail.requestedAmount)} over ${detail.requestedTenorMonths} months, as requested.`
        : amountText && tenorValid
          ? `Counter-offer: ${formatPeso(amountText)} over ${tenor.trim()} months.`
          : "Counter-offer: enter a valid amount and tenor.";

  return (
    <ConfirmDialog
      open
      title="Recommend a decision"
      description="An approver decides on your recommendation. A recommendation that changes the decision or the terms needs a reason code."
      confirmLabel="Send to approver"
      busy={busy}
      error={error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-4">
        <Field label="Recommendation" error={fieldError("type")}>
          <select
            className={inputClass}
            value={type}
            onChange={(e) => setType(e.target.value as Recommendation)}
          >
            <option value="APPROVE">Approve as requested</option>
            <option value="COUNTER_OFFER">Counter-offer</option>
            <option value="DECLINE">Decline</option>
          </select>
        </Field>
        {type === "COUNTER_OFFER" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (pesos)" error={fieldError("amount")}>
              <input
                className={inputClass}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Tenor (months)" error={fieldError("tenorMonths")}>
              <input
                className={inputClass}
                inputMode="numeric"
                value={tenor}
                onChange={(e) => setTenor(e.target.value)}
              />
            </Field>
          </div>
        )}
        <p aria-live="polite" className="text-sm font-semibold text-ink-900">
          {summary}
        </p>
        <Field
          label={changesTerms ? "Reason code (required)" : "Reason code (optional)"}
          hint="Required when the recommendation differs from the application."
          error={fieldError("overrideReason")}
        >
          <select
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value as OverrideReason | "")}
          >
            <option value="">Choose a reason</option>
            {Object.entries(OVERRIDE_REASON_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {code} · {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rationale" error={fieldError("rationale")}>
          <textarea
            className={inputClass}
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

function DeclineDialog({
  detail,
  busy,
  error,
  fieldErrors,
  onCancel,
  onSubmit,
}: {
  detail: CaseDetail;
  busy: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onCancel: () => void;
  onSubmit: (body: DeclineRequest) => void;
}) {
  const [reason, setReason] = useState<DeclineReason | "">("");
  const [note, setNote] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      title="Decline this application?"
      description={`${detail.applicant.fullName} is told the reason in plain words, without internal scores. This cannot be undone.`}
      confirmLabel="Decline"
      variant="danger"
      busy={busy}
      error={error}
      onConfirm={() => {
        if (!reason) return setLocal("Choose a reason code.");
        setLocal(null);
        onSubmit({ reasonCode: reason, note: note.trim() || undefined });
      }}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason code" error={local ?? fieldErrors.reasonCode}>
          <select
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value as DeclineReason | "")}
          >
            <option value="">Choose a reason</option>
            {Object.entries(DECLINE_REASON_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {code} · {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note (optional)" error={fieldErrors.note}>
          <textarea
            className={inputClass}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
