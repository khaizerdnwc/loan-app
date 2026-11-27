"use client";

import {
  type ActionAvailability,
  type CaseAction,
  type CaseDetail,
  DECLINE_REASON_LABEL,
  type DeclineReason,
  type DeclineRequest,
  DOCUMENT_TYPE_LABEL,
  DRAFT_EXPIRY_DAYS,
  OFFER_EXPIRY_DAYS,
  OVERRIDE_REASON_LABEL,
  type OverrideReason,
  ProblemCode,
  type Recommendation,
  type RecommendRequest,
  WITHDRAW_REASON_LABEL,
  type WithdrawReason,
  type WithdrawRequest,
} from "@loan/core";
import {
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Field,
  FormGrid,
  FormStack,
  formatAmountsInText,
  formatDate,
  formatDateTime,
  formatMonthlyRate,
  formatPeso,
  Input,
  Select,
  Textarea,
  useToast,
} from "@loan/ui";
import { type ReactNode, useState } from "react";
import { useShellRefresh } from "@/components/app-shell";
import { RequestInfoDialog } from "@/components/case/request-info-dialog";
import { ApiError, api, errorMessage, fieldErrorsOf } from "@/lib/api";
import { MAX_AMOUNT, MIN_AMOUNT, toCentavos, toDecimalString } from "@/lib/application-schema";
import { isOverdue } from "@/lib/info-request";

interface SimpleAction {
  label: string;
  path: (id: string) => string;
  variant: "primary" | "accent" | "danger" | "secondary";
  title: (c: CaseDetail) => string;
  describe: (c: CaseDetail) => ReactNode;
  /** The toast after success, worded from the case the API returned. */
  done: string | ((next: CaseDetail) => string);
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
      `${repaymentSentence(c)}${c.applicant.fullName} receives an offer on these terms. Your authority is checked by the system when you confirm.`,
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
  REDECIDE: {
    label: "Decide again",
    path: (id) => `/cases/${id}/redecide`,
    variant: "primary",
    title: (c) => `Decide ${c.applicant.fullName}'s application again?`,
    describe: (c) =>
      `${formatPeso(c.requestedAmount)} over ${c.requestedTenorMonths} months. It was referred because a provider could not answer. The simulated bureau, screening and fraud check are asked again and the decision rules run on their answers: it may be approved at once, referred to you again, or declined. The earlier decision record is kept.`,
    done: (next) =>
      next.outcome === "AUTO_APPROVE"
        ? "Decided again — approved; waiting for the borrower's e-signature"
        : next.outcome === "AUTO_DECLINE"
          ? "Decided again — declined"
          : "Decided again — still referred for review",
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

/**
 * The monthly repayment being approved, as the prototype's approve dialog states it ("Monthly
 * repayment ₱6,920.00 at grade C (calculated by core)"), from core banking's quote for the
 * recommended terms. When core cannot quote it the dialog says so; approving does not need it.
 */
function repaymentSentence(c: CaseDetail): string {
  const q = c.proposedRepayment;
  if (!q) return "";
  return q.status === "QUOTED"
    ? `Monthly repayment ${formatPeso(q.regularInstalment)} at grade ${q.grade} (${formatMonthlyRate(q.monthlyRate)}), calculated by core banking (simulated). `
    : "Core banking (simulated) could not quote the monthly repayment just now; approving does not depend on it. ";
}

/** Problem codes the API returns after committing a change to the case (escalation, failure). */
const CHANGES_ON_REFUSAL = new Set<string>([
  ProblemCode.AuthorityLimit,
  ProblemCode.ProviderUnavailable,
  ProblemCode.ScheduleMismatch,
  // A watchlist match before disbursement holds the booking (Booking failed, PRD CMP-005).
  ProblemCode.ScreeningMatch,
]);

type Open =
  | { kind: "simple"; action: CaseAction }
  | { kind: "recommend" }
  | { kind: "decline" }
  | { kind: "withdraw" }
  | { kind: "request-info" }
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
  // While a re-decision is offered it is the next step; recommending is secondary.
  const redecideOffered = actions.some((a) => a.action === "REDECIDE" && a.enabled);

  async function run(path: string, body: unknown, done: SimpleAction["done"]) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const next = await api<CaseDetail>(path, { method: "POST", body });
      toast(typeof done === "string" ? done : done(next));
      setOpen(null);
      onChanged(next);
      refreshShell();
    } catch (e) {
      // The pre-booking checklist failed since the case was loaded: nothing was written. Show
      // the refreshed checklist and the disabled action with its reason, and close the dialog
      // so it never offers an action the refreshed case blocks.
      if (e instanceof ApiError && e.code === ProblemCode.BookingChecklistIncomplete) {
        toast(errorMessage(e), "warn");
        setOpen(null);
        api<CaseDetail>(`/cases/${detail.id}`).then(onChanged, () =>
          toast("Reload the page to see the case's current checklist.", "warn"),
        );
        return;
      }
      setError(errorMessage(e));
      setFieldErrors(fieldErrorsOf(e));
      // Some refusals still change the case on the server: an approval above authority
      // escalates it (R-6), and a failed booking marks it Booking failed (B-5). Show that.
      if (e instanceof ApiError && CHANGES_ON_REFUSAL.has(e.code)) {
        api<CaseDetail>(`/cases/${detail.id}`).then(
          (next) => {
            onChanged(next);
            // Keep the dialog truthful: a failed booking is now retried, so the open
            // confirmation becomes the retry the refreshed case offers.
            const retry = next.allowedActions.find((x) => x.action === "RETRY_BOOKING");
            if (retry?.enabled)
              setOpen((o) =>
                o?.kind === "simple" ? { kind: "simple", action: "RETRY_BOOKING" } : o,
              );
            else if (retry) {
              // Held (e.g. for Compliance): nothing to confirm now. Close the dialog, show the
              // refusal as a toast; the panel says why the retry is blocked and who acts next.
              setOpen(null);
              toast(errorMessage(e), "bad");
            }
          },
          () =>
            setError((msg) =>
              `${msg ?? ""} Reload the page to see the case's current state.`.trim(),
            ),
        );
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
    else if (a.action === "WITHDRAW") setOpen({ kind: "withdraw" });
    else if (a.action === "REQUEST_INFO") setOpen({ kind: "request-info" });
    else setOpen({ kind: "simple", action: a.action });
  }

  const simple = open?.kind === "simple" ? SIMPLE[open.action] : undefined;
  const tools = actions.filter((a) => TOOLS.has(a.action));
  const steps = actions.filter((a) => !TOOLS.has(a.action));

  return (
    <Card title="Next action">
      <p className="text-sm">{waitingFor(detail)}</p>
      {/* The prototype's next-action card: the case's actions inline (the step forward is the
          one primary button), why any of them is blocked underneath, and tools that close
          the case (Withdraw) apart, under a divider, in the small size. */}
      {steps.length > 0 && (
        <div data-group="steps" className="mt-4 flex flex-wrap gap-2">
          {steps.map((a) => (
            <ActionButton key={a.action} a={a} redecideOffered={redecideOffered} start={start} />
          ))}
        </div>
      )}
      <BlockedReasons actions={steps} />
      {tools.length > 0 && (
        <div data-group="tools" className="mt-4 border-t border-line-soft pt-4">
          <div className="flex flex-wrap gap-2">
            {tools.map((a) => (
              <ActionButton
                key={a.action}
                a={a}
                redecideOffered={redecideOffered}
                start={start}
                size="sm"
              />
            ))}
          </div>
          <BlockedReasons actions={tools} />
        </div>
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
      {open?.kind === "request-info" && (
        <RequestInfoDialog
          detail={detail}
          busy={busy}
          error={error}
          fieldErrors={fieldErrors}
          onCancel={() => setOpen(null)}
          onSubmit={(body) =>
            run(
              `/cases/${detail.id}/info-request`,
              body,
              "Request sent — the case waits for the borrower's documents",
            )
          }
        />
      )}
      {open?.kind === "withdraw" && (
        <WithdrawDialog
          detail={detail}
          busy={busy}
          error={error}
          fieldErrors={fieldErrors}
          onCancel={() => setOpen(null)}
          onSubmit={(body) =>
            run(`/cases/${detail.id}/withdraw`, body, "Withdrawn — the application is closed")
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
  return !a.enabled && a.action === "APPROVE" && a.blockedBy === ProblemCode.AuthorityLimit;
}

/** Actions that close the case rather than move it on: shown apart, as the prototype does. */
const TOOLS = new Set<CaseAction>(["WITHDRAW"]);

/** Why each disabled action in a group is blocked, under its buttons and linked to them. */
function BlockedReasons({ actions }: { actions: ActionAvailability[] }) {
  const blocked = actions.filter((a) => !a.enabled);
  if (blocked.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {blocked.map((a) => (
        <li key={a.action} id={`${a.action}-blocked`} className="text-xs text-bad-700">
          <span className="font-semibold">{labelOf(a.action)}:</span>{" "}
          {formatAmountsInText(a.detail)}
        </li>
      ))}
    </ul>
  );
}

function ActionButton({
  a,
  redecideOffered,
  start,
  size = "md",
}: {
  a: ActionAvailability;
  redecideOffered: boolean;
  start: (a: ActionAvailability) => void;
  size?: "md" | "sm";
}) {
  return (
    <Button
      size={size}
      variant={variantFor(a, redecideOffered)}
      disabled={!a.enabled && !canAttempt(a)}
      aria-describedby={a.enabled ? undefined : `${a.action}-blocked`}
      onClick={() => start(a)}
    >
      {labelOf(a.action)}
    </Button>
  );
}

/**
 * One rule for the panel's buttons: the action that moves the case forward is primary, a
 * decline is danger, and anything that changes nothing (viewing the record), should wait
 * (recommending while a re-decide is offered) or steps off the path (withdrawing; its dialog
 * confirms in danger) is secondary, as is a disabled action.
 */
function variantFor(a: ActionAvailability, redecideOffered: boolean): SimpleAction["variant"] {
  if (!a.enabled) return "secondary";
  if (a.action === "DECLINE") return "danger";
  if (a.action === "REPRODUCE_DECISION") return "secondary";
  if (a.action === "WITHDRAW") return "secondary";
  if (a.action === "REQUEST_INFO") return "secondary";
  if (a.action === "RECOMMEND" && redecideOffered) return "secondary";
  return SIMPLE[a.action]?.variant ?? "primary";
}

function labelOf(action: CaseAction): string {
  if (action === "RECOMMEND") return "Recommend a decision";
  if (action === "DECLINE") return "Decline";
  if (action === "REPRODUCE_DECISION") return "View decision record";
  if (action === "WITHDRAW") return "Withdraw application";
  if (action === "REQUEST_INFO") return "Request information";
  return SIMPLE[action]?.label ?? action;
}

/** The case's next deadline (a draft or an offer expires), as a sentence to append. */
function expiresNote(c: CaseDetail): string {
  return c.expiresAt ? ` Expires on ${formatDateTime(c.expiresAt)}.` : "";
}

/** What the case is waiting for and who acts next, in words. */
function waitingFor(c: CaseDetail): string {
  switch (c.status) {
    case "DRAFT":
      return `Draft: nothing has been checked yet. The loan officer submits it for decision.${expiresNote(c)}`;
    case "REVIEW":
      return c.decidedDuringOutage
        ? "Referred because a provider could not answer: the loan officer decides it again once the provider is back."
        : "Referred: a loan officer reviews the evidence and recommends a decision.";
    case "INFO_REQUESTED":
      return c.infoRequest
        ? `Waiting for the borrower (simulated): ${c.infoRequest.documents.map((d) => DOCUMENT_TYPE_LABEL[d]).join("; ")}. ${isOverdue(c.infoRequest.dueOn) ? `Overdue since ${formatDate(c.infoRequest.dueOn)}: the borrower has not answered by the due date; follow up, or withdraw the application.` : `Due ${formatDate(c.infoRequest.dueOn)}.`} The case goes back to review when everything has arrived.`
        : "Waiting for the borrower's documents. The case goes back to review when everything has arrived.";
    case "APPROVAL":
      return c.escalated
        ? "Waiting for an approver whose authority covers this amount and grade."
        : "Waiting for an approver to decide on the recommendation.";
    case "OFFER":
      return `Approved. Waiting for the borrower's e-signature (simulated), recorded by loan operations.${expiresNote(c)}`;
    case "BOOKING":
      return "Signed. Loan operations submits the booking; a supervisor checks it.";
    case "PENDING_CHECKER":
      return "Waiting for a loan operations supervisor — not the person who submitted it — to approve the booking.";
    case "BOOKING_FAILED":
      return c.allowedActions.some((a) => !a.enabled && a.blockedBy === ProblemCode.ComplianceHold)
        ? "Held for Compliance: screening before disbursement matched. Compliance reviews the match; once they clear it, a loan operations supervisor can retry the booking."
        : "The last booking attempt failed. A supervisor can retry it safely with the same booking key.";
    case "DISBURSED":
      return "Booked in core banking and disbursed. Nothing left to do.";
    case "DECLINED":
      return "Declined. The borrower is told why, without internal scores.";
    case "WITHDRAWN":
      return c.withdrawal
        ? `Withdrawn: closed by ${c.withdrawal.byName} (${WITHDRAW_REASON_LABEL[c.withdrawal.reasonCode]}). Nothing left to do; a new application can be captured.`
        : "Withdrawn: closed by the loan officer. Nothing left to do; a new application can be captured.";
    case "EXPIRED":
      return c.closedFrom === "OFFER"
        ? `Expired: the offer was not signed within ${OFFER_EXPIRY_DAYS} days of approval, so the system closed it. A new application can be captured.`
        : `Expired: the draft was unchanged for ${DRAFT_EXPIRY_DAYS} days, so the system closed it. A new application can be captured.`;
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
  // The API lists which types it accepts now (only a decline after an outage or a failed
  // knockout). Start on the first accepted one; an empty list (no rule known) accepts all.
  const offered = detail.recommendationTypes ?? [];
  const refusedType = (t: Recommendation) => offered.some((o) => o.type === t && !o.enabled);
  const refusal = offered.find((o) => !o.enabled);
  const [type, setType] = useState<Recommendation>(
    offered.find((o) => o.enabled)?.type ?? "APPROVE",
  );
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
      <FormStack>
        <Field label="Recommendation" error={fieldError("type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as Recommendation)}>
            <option value="APPROVE" disabled={refusedType("APPROVE")}>
              Approve as requested
            </option>
            <option value="COUNTER_OFFER" disabled={refusedType("COUNTER_OFFER")}>
              Counter-offer
            </option>
            <option value="DECLINE" disabled={refusedType("DECLINE")}>
              Decline
            </option>
          </Select>
        </Field>
        {refusal && !refusal.enabled && <Callout tone="warn">{refusal.detail}</Callout>}
        {type === "COUNTER_OFFER" && (
          <FormGrid>
            <Field label="Amount (pesos)" error={fieldError("amount")}>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Tenor (months)" error={fieldError("tenorMonths")}>
              <Input inputMode="numeric" value={tenor} onChange={(e) => setTenor(e.target.value)} />
            </Field>
          </FormGrid>
        )}
        <p aria-live="polite" className="text-sm font-semibold text-ink-900">
          {summary}
        </p>
        <Field
          label={changesTerms ? "Reason code (required)" : "Reason code (optional)"}
          hint="Required when the recommendation differs from the application."
          error={fieldError("overrideReason")}
        >
          <Select value={reason} onChange={(e) => setReason(e.target.value as OverrideReason | "")}>
            <option value="">Choose a reason</option>
            {Object.entries(OVERRIDE_REASON_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {code} · {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rationale" error={fieldError("rationale")}>
          <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
      </FormStack>
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
      <FormStack>
        <Field label="Reason code" error={local ?? fieldErrors.reasonCode}>
          <Select value={reason} onChange={(e) => setReason(e.target.value as DeclineReason | "")}>
            <option value="">Choose a reason</option>
            {Object.entries(DECLINE_REASON_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {code} · {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" error={fieldErrors.note}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </FormStack>
    </ConfirmDialog>
  );
}

function WithdrawDialog({
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
  onSubmit: (body: WithdrawRequest) => void;
}) {
  const [reason, setReason] = useState<WithdrawReason | "">("");
  const [note, setNote] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      title="Withdraw this application?"
      description={`${detail.reference} for ${detail.applicant.fullName} (${formatPeso(amountOf(detail))} over ${tenorOf(detail)} months) is closed and goes no further. This cannot be undone; a new application can be captured afterwards.`}
      confirmLabel="Withdraw"
      variant="danger"
      busy={busy}
      error={error}
      onConfirm={() => {
        if (!reason) return setLocal("Choose a reason.");
        setLocal(null);
        onSubmit({ reasonCode: reason, note: note.trim() || undefined });
      }}
      onCancel={onCancel}
    >
      <FormStack>
        <Field label="Reason" error={local ?? fieldErrors.reasonCode}>
          <Select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as WithdrawReason | "");
              if (e.target.value) setLocal(null);
            }}
          >
            <option value="">Choose a reason</option>
            {Object.entries(WITHDRAW_REASON_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" error={fieldErrors.note}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </FormStack>
    </ConfirmDialog>
  );
}
