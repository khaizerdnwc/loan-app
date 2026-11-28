"use client";

import type { ApplicantView, CoreCustomerView, NewApplicantRequest } from "@loan/core";
import {
  Button,
  Callout,
  ConfirmDialog,
  Field,
  FormGrid,
  FormStack,
  formatPeso,
  Input,
  KeyValues,
  SegmentedFilter,
  SimulatedLabel,
} from "@loan/ui";
import { useState } from "react";
import { ApiError, api, errorMessage, fieldErrorsOf } from "@/lib/api";
import { toDecimalString } from "@/lib/application-schema";

type Mode = "CORE" | "NEW";

interface Facts {
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
  employer: string;
  employmentMonths: string;
  monthlyIncome: string;
  monthlyObligations: string;
}

const EMPTY: Facts = {
  fullName: "",
  birthDate: "",
  governmentIdLast4: "",
  employer: "",
  employmentMonths: "",
  monthlyIncome: "",
  monthlyObligations: "",
};

/**
 * Capture a new applicant at the branch (PRD INT-005): an existing WhiteBank customer found in
 * simulated core banking by customer number (PRD INT-002), or a walk-in new to the bank typed
 * in by hand. Core being down never stops the second: the dialog says so and offers it.
 * For a core customer, identity, account and relationship come from core (the API takes them
 * from there); the officer confirms employment and what the applicant declares.
 */
export function NewApplicantDialog({
  onCancel,
  onCreated,
  onChooseExisting,
}: {
  onCancel: () => void;
  onCreated: (a: ApplicantView) => void;
  /** The customer is already on file as this applicant: choose them instead. */
  onChooseExisting: (applicantId: string, fullName: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("CORE");
  const [cif, setCif] = useState("");
  const [customer, setCustomer] = useState<CoreCustomerView | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [coreDown, setCoreDown] = useState(false);
  const [facts, setFacts] = useState<Facts>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof Facts) => (e: { target: { value: string } }) =>
    setFacts((f) => ({ ...f, [k]: e.target.value }));

  async function find() {
    setLookupError(null);
    setCustomer(null);
    setCoreDown(false);
    setError(null);
    if (!cif.trim()) {
      setLookupError("Enter the customer number, e.g. CIF-100245.");
      return;
    }
    setBusy(true);
    try {
      const found = await api<CoreCustomerView>(`/customers/${encodeURIComponent(cif.trim())}`);
      setCustomer(found);
      setFacts({
        ...EMPTY,
        employer: found.employer,
        employmentMonths: String(found.employmentMonths),
        monthlyIncome: found.monthlyIncome,
        monthlyObligations: found.monthlyObligations,
      });
    } catch (e) {
      setCoreDown(e instanceof ApiError && e.status === 503);
      setLookupError(
        e instanceof ApiError && e.status === 404
          ? "Core banking has no customer with this number. Check it, or capture a new customer."
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }

  // Add applicant is offered only when the API would accept it: by hand, or for a customer
  // found in core who is not on file yet (one already on file is chosen instead).
  const blocked =
    mode === "CORE" && !customer
      ? "Find the customer in core banking first, or capture a customer new to the bank."
      : mode === "CORE" && customer?.applicantId
        ? "This customer is already on file: choose them instead."
        : null;

  async function save() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body: NewApplicantRequest = {
      ...(mode === "CORE" && customer ? { customerNumber: customer.customerNumber } : {}),
      fullName: facts.fullName.trim(),
      birthDate: facts.birthDate,
      governmentIdLast4: facts.governmentIdLast4.trim(),
      employer: facts.employer.trim(),
      // Blank is not 0 months: leave it out, and the API asks for it.
      employmentMonths:
        facts.employmentMonths.trim() === ""
          ? undefined
          : Number.parseInt(facts.employmentMonths, 10),
      monthlyIncome: toDecimalString(facts.monthlyIncome),
      monthlyObligations: toDecimalString(facts.monthlyObligations || "0"),
    };
    try {
      onCreated(await api<ApplicantView>("/applicants", { method: "POST", body }));
    } catch (e) {
      setError(errorMessage(e));
      setFieldErrors(fieldErrorsOf(e));
    } finally {
      setBusy(false);
    }
  }

  const err = (name: keyof Facts) => fieldErrors[name];

  return (
    <ConfirmDialog
      open
      title="New or walk-in customer"
      description="Find an existing WhiteBank customer in core banking to pre-fill their details, or capture a customer new to the bank by hand."
      confirmLabel="Add applicant"
      busy={busy}
      error={error}
      confirmDisabled={blocked}
      onConfirm={save}
      onCancel={onCancel}
    >
      <FormStack>
        <SegmentedFilter
          label="Customer"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
            setFieldErrors({});
          }}
          options={[
            { value: "CORE", label: "Existing customer" },
            { value: "NEW", label: "New to the bank" },
          ]}
        />

        {mode === "CORE" && (
          <>
            <div className="flex items-end gap-2">
              <div className="grow">
                <Field label="Customer number" error={lookupError ?? fieldErrors.customerNumber}>
                  <Input
                    value={cif}
                    autoComplete="off"
                    placeholder="CIF-100245"
                    onChange={(e) => setCif(e.target.value)}
                  />
                </Field>
              </div>
              <Button variant="secondary" onClick={find} disabled={busy}>
                Find in core
              </Button>
            </div>
            {coreDown && (
              <Callout tone="warn" lead="Core banking is not answering.">
                Nothing was looked up. You can still capture this customer by hand.{" "}
                <Button size="sm" variant="secondary" onClick={() => setMode("NEW")}>
                  Capture by hand
                </Button>
              </Callout>
            )}
            {customer && (
              <div data-testid="core-customer" className="flex flex-col gap-3">
                <p className="flex items-center gap-2 text-sm">
                  <strong className="text-ink-900">From core banking</strong>
                  <SimulatedLabel what="core customer file" />
                </p>
                <KeyValues
                  items={[
                    { label: "Name", value: customer.fullName },
                    { label: "Customer for", value: `${customer.relationshipMonths} months` },
                    { label: "Deposit account", value: customer.depositAccount, mono: true },
                    { label: "Salary credits", value: formatPeso(customer.monthlyIncome) },
                  ]}
                />
                {customer.applicantId ? (
                  <Callout tone="info" lead="Already on file.">
                    This customer is applicant{" "}
                    <span className="font-mono text-xs">{customer.applicantId}</span>.{" "}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        onChooseExisting(customer.applicantId as string, customer.fullName)
                      }
                    >
                      Choose them
                    </Button>
                  </Callout>
                ) : (
                  <EmploymentFields
                    facts={facts}
                    set={set}
                    err={err}
                    incomeLabel="Declared monthly income (pesos)"
                  />
                )}
              </div>
            )}
          </>
        )}

        {mode === "NEW" && (
          <>
            <Field label="Full name" error={err("fullName")}>
              <Input value={facts.fullName} onChange={set("fullName")} />
            </Field>
            <FormGrid>
              <Field label="Birth date" error={err("birthDate")}>
                <Input type="date" value={facts.birthDate} onChange={set("birthDate")} />
              </Field>
              <Field
                label="Government ID (last 4 digits)"
                error={err("governmentIdLast4")}
                hint="Only the last 4 digits are stored."
              >
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  value={facts.governmentIdLast4}
                  onChange={set("governmentIdLast4")}
                />
              </Field>
            </FormGrid>
            <EmploymentFields
              facts={facts}
              set={set}
              err={err}
              incomeLabel="Monthly income (pesos)"
            />
            <Callout tone="info" lead="Not bookable yet.">
              A customer new to the bank has no WhiteBank deposit account, so the loan cannot be
              booked until one is opened and they are captured again from core banking.
            </Callout>
          </>
        )}
      </FormStack>
    </ConfirmDialog>
  );
}

function EmploymentFields({
  facts,
  set,
  err,
  incomeLabel,
}: {
  facts: Facts;
  set: (k: keyof Facts) => (e: { target: { value: string } }) => void;
  err: (k: keyof Facts) => string | undefined;
  incomeLabel: string;
}) {
  return (
    <>
      <FormGrid>
        <Field label="Employer" error={err("employer")}>
          <Input value={facts.employer} onChange={set("employer")} />
        </Field>
        <Field label="Months with employer" error={err("employmentMonths")}>
          <Input
            inputMode="numeric"
            value={facts.employmentMonths}
            onChange={set("employmentMonths")}
          />
        </Field>
      </FormGrid>
      <FormGrid>
        <Field label={incomeLabel} error={err("monthlyIncome")}>
          <Input inputMode="decimal" value={facts.monthlyIncome} onChange={set("monthlyIncome")} />
        </Field>
        <Field label="Monthly obligations (pesos)" error={err("monthlyObligations")}>
          <Input
            inputMode="decimal"
            value={facts.monthlyObligations}
            onChange={set("monthlyObligations")}
          />
        </Field>
      </FormGrid>
    </>
  );
}
