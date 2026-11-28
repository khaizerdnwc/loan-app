"use client";

import {
  type ConfirmIntakeDraftRequest,
  EXTRACTION_FLAG_LABEL,
  type IntakeDraftView,
  ProblemCode,
} from "@loan/core";
import {
  Button,
  Callout,
  Field,
  FormGrid,
  FormStack,
  formatDate,
  formatPeso,
  Input,
  KeyValues,
  Modal,
  Textarea,
} from "@loan/ui";
import { useState } from "react";
import { ApiError, api, errorMessage, fieldErrorsOf } from "@/lib/api";

/** Refusals that mean the draft moved on since the list was loaded. */
const STALE = new Set<string>([ProblemCode.InvalidTransition, ProblemCode.NotFound]);

/** The new-customer inputs this dialog renders for a draft no customer matches. */
const NEW_CUSTOMER_FIELDS = [
  "newCustomer.employmentMonths",
  "newCustomer.monthlyObligations",
  "newCustomer.customerNumber",
];

/** What OCR could not read from the file (it is a field of the synthetic file, not a provider outage). */
const NOT_READ = "Not in the file";

/**
 * The prototype's "Review draft" dialog (Email and file intake): what OCR extracted, its flags,
 * and the terms the loan officer confirms. Confirming creates an application draft — it is not
 * submitted; consent and submission happen on the case, as for any application. Discarding
 * needs a reason. The API decides both; this only shows its answer.
 */
export function ReviewDraftDialog({
  draft,
  onClose,
  onConfirmed,
  onDiscarded,
  onStale,
}: {
  draft: IntakeDraftView;
  onClose: () => void;
  onConfirmed: (next: IntakeDraftView) => void;
  onDiscarded: (next: IntakeDraftView) => void;
  onStale: (message: string) => void;
}) {
  const x = draft.extracted;
  const [amount, setAmount] = useState(x.amount ?? "");
  const [tenor, setTenor] = useState(x.tenorMonths === null ? "" : String(x.tenorMonths));
  const [purpose, setPurpose] = useState(x.purpose ?? "");
  const [govId, setGovId] = useState("");
  const [employmentMonths, setEmploymentMonths] = useState("");
  const [obligations, setObligations] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  // A draft the API will not let be confirmed opens straight in discard mode.
  const [discarding, setDiscarding] = useState(!draft.actions.includes("CONFIRM"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const name = x.fullName ?? "Unnamed applicant";
  const noMatch = draft.flags.includes("NO_CUSTOMER_MATCH");
  // The API lists what it accepts: a draft several customer records match offers discard only.
  const canConfirm = draft.actions.includes("CONFIRM");
  const severalMatch = draft.flags.includes("SEVERAL_CUSTOMERS_MATCH");
  const otherFlags = draft.flags.filter(
    (f) => f !== "NO_CUSTOMER_MATCH" && f !== "SEVERAL_CUSTOMERS_MATCH",
  );
  // The fields this dialog renders an input for, now; any other field error goes in the callout.
  const shown = discarding
    ? ["reason"]
    : [
        "amount",
        "tenorMonths",
        "purpose",
        ...(x.governmentIdLast4 === null ? ["governmentIdLast4"] : []),
        ...(noMatch ? NEW_CUSTOMER_FIELDS : []),
      ];
  const unplaced = Object.entries(fields)
    .filter(([field]) => !shown.includes(field))
    .map(([, message]) => message);

  async function run<T>(call: () => Promise<T>, done: (value: T) => void) {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      done(await call());
    } catch (e) {
      if (e instanceof ApiError && STALE.has(e.code)) {
        onStale(errorMessage(e));
        return;
      }
      setError(errorMessage(e));
      setFields(fieldErrorsOf(e));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    const body: ConfirmIntakeDraftRequest = {
      amount: amount.trim(),
      tenorMonths: Number(tenor),
      purpose,
      ...(x.governmentIdLast4 === null && govId.trim() ? { governmentIdLast4: govId.trim() } : {}),
      // No customer on record matches: capture them from the draft in the same step.
      ...(noMatch
        ? {
            newCustomer: {
              // Blank is not 0 months: leave it out, and the API asks for it.
              employmentMonths:
                employmentMonths.trim() === "" ? undefined : Number(employmentMonths),
              monthlyObligations: obligations.trim(),
              ...(customerNumber.trim() ? { customerNumber: customerNumber.trim() } : {}),
            },
          }
        : {}),
    };
    void run(
      () => api<IntakeDraftView>(`/intake/drafts/${draft.id}/confirm`, { method: "POST", body }),
      onConfirmed,
    );
  }

  function discard() {
    if (!reason.trim()) {
      setFields({ reason: "Enter why this draft is not taken forward." });
      return;
    }
    void run(
      () =>
        api<IntakeDraftView>(`/intake/drafts/${draft.id}/discard`, {
          method: "POST",
          body: { reason: reason.trim() },
        }),
      onDiscarded,
    );
  }

  const footer = discarding ? (
    <>
      {canConfirm ? (
        <Button variant="secondary" onClick={() => setDiscarding(false)} disabled={busy}>
          Back
        </Button>
      ) : (
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      )}
      <Button variant="danger" onClick={discard} disabled={busy}>
        Discard draft
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button variant="danger" onClick={() => setDiscarding(true)} disabled={busy}>
        Discard…
      </Button>
      {canConfirm && (
        <Button variant="primary" onClick={confirm} disabled={busy}>
          {noMatch ? "Capture customer and create draft" : "Create application draft"}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open
      title={`Review draft · ${name}`}
      description={
        canConfirm
          ? `Extracted by OCR (simulated) from ${draft.sourceDetail} in "${draft.fileName}". Check the values and complete anything missing. Creating the draft does not submit it: record the applicant's consent and submit it from the case.`
          : `Extracted by OCR (simulated) from ${draft.sourceDetail} in "${draft.fileName}". This draft cannot be confirmed, so it can only be discarded, with the reason it is not taken forward.`
      }
      onClose={onClose}
      busy={busy}
      footer={footer}
    >
      <FormStack>
        <KeyValues
          items={[
            { label: "Name", value: name },
            { label: "Birth date", value: x.birthDate ? formatDate(x.birthDate) : NOT_READ },
            {
              label: "Government ID",
              value: x.governmentIdLast4 ? `•••• ${x.governmentIdLast4}` : NOT_READ,
              mono: x.governmentIdLast4 !== null,
            },
            { label: "Employer", value: x.employer ?? NOT_READ },
            {
              label: "Declared income",
              value: x.declaredMonthlyIncome ? formatPeso(x.declaredMonthlyIncome) : NOT_READ,
            },
            ...(x.documentMonthlyIncome
              ? [{ label: "Payslip income (OCR)", value: formatPeso(x.documentMonthlyIncome) }]
              : []),
            {
              label: "Customer on record",
              value:
                draft.matchedApplicant?.fullName ??
                (severalMatch ? "Several records match" : "No match yet"),
            },
          ]}
        />
        {severalMatch && (
          <Callout tone="warn" lead="Several customer records match this draft.">
            It cannot be confirmed while several records have this name, birth date and ID. Discard
            it, then start the application from the right customer under New application.
          </Callout>
        )}
        {noMatch && (
          <Callout tone="warn" lead="No customer on record matches this draft.">
            Creating the draft also captures them as a new applicant from the file's name, birth
            date, ID, employer and declared income. Add what the file does not carry below; give
            their core customer number only if they already bank with WhiteBank.
          </Callout>
        )}
        {otherFlags.length > 0 && (
          <Callout tone="warn" lead="OCR flagged:">
            {otherFlags.map((f) => EXTRACTION_FLAG_LABEL[f]).join("; ")}.
          </Callout>
        )}
        {discarding ? (
          <Field label="Why is this draft not taken forward" error={fields.reason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : (
          <>
            <FormGrid>
              <Field label="Amount (pesos)" error={fields.amount}>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Tenor (months)" error={fields.tenorMonths}>
                <Input
                  inputMode="numeric"
                  value={tenor}
                  onChange={(e) => setTenor(e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label="Purpose" error={fields.purpose}>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </Field>
            {noMatch && (
              <>
                <FormGrid>
                  <Field
                    label="Months with employer"
                    error={fields["newCustomer.employmentMonths"]}
                  >
                    <Input
                      inputMode="numeric"
                      value={employmentMonths}
                      onChange={(e) => setEmploymentMonths(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Monthly obligations (pesos)"
                    error={fields["newCustomer.monthlyObligations"]}
                  >
                    <Input
                      inputMode="decimal"
                      value={obligations}
                      onChange={(e) => setObligations(e.target.value)}
                    />
                  </Field>
                </FormGrid>
                <Field
                  label="Core customer number (optional)"
                  hint="Only for an existing WhiteBank customer: core banking then supplies their identity and account (simulated)."
                  error={fields["newCustomer.customerNumber"]}
                >
                  <Input
                    value={customerNumber}
                    onChange={(e) => setCustomerNumber(e.target.value)}
                  />
                </Field>
              </>
            )}
            {x.governmentIdLast4 === null && (
              <Field
                label="Government ID, last 4 digits"
                hint="The file did not include it: copy it from the applicant's ID."
                error={fields.governmentIdLast4}
              >
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  value={govId}
                  onChange={(e) => setGovId(e.target.value)}
                />
              </Field>
            )}
          </>
        )}
        {error && (
          <Callout tone="bad" alert lead={error}>
            {/* A field error with no input in this dialog (e.g. the ID when OCR read it) has
                nowhere else to show, so it is spelled out here. */}
            {unplaced.length > 0 && unplaced.join(" ")}
          </Callout>
        )}
      </FormStack>
    </Modal>
  );
}
