"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ApplicantView,
  type CaseDetail,
  CONSENT_TERMS_VERSION,
  type CreateCaseRequest,
  productLabel,
} from "@loan/core";

/** The one product this release captures. */
const PRODUCT_CODE = "PL";

import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  FormGrid,
  formatPeso,
  Input,
  KeyValues,
  Select,
  useToast,
} from "@loan/ui";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { PageHeader } from "@/components/app-shell";
import { IndicativeRepayment } from "@/components/case/indicative-repayment";
import { LoadState } from "@/components/load-state";
import { NewApplicantDialog } from "@/components/new-applicant-dialog";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";
import {
  type ApplicationForm,
  applicationSchema,
  MAX_AMOUNT,
  MIN_AMOUNT,
  toDecimalString,
} from "@/lib/application-schema";
import { CONSENT_LABEL } from "@/lib/consent";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { useIndicativeRepayment } from "@/lib/use-indicative-repayment";

type Intent = "draft" | "submit";

const FORM_FIELDS = ["applicantId", "amount", "tenorMonths", "purpose"] as const;
type FormField = (typeof FORM_FIELDS)[number];
const isFormField = (name: string): name is FormField =>
  (FORM_FIELDS as readonly string[]).includes(name);

export default function NewApplicationPage() {
  const me = useSession();
  const router = useRouter();
  const toast = useToast();
  const applicants = useApi<ApplicantView[]>(me.role === "LOAN_OFFICER" ? "/applicants" : null);
  const [pending, setPending] = useState<{ intent: Intent; values: ApplicationForm } | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  /** Applicants captured on this page: listed at once, before the refetched list arrives. */
  const [added, setAdded] = useState<ApplicantView[]>([]);
  /**
   * An applicant to select once its option is in the list (a select cannot pick a missing one).
   * `settled` once the list has been refreshed for it: if it is still missing then, the officer
   * is told and nothing is selected later behind their back.
   */
  const [toSelect, setToSelect] = useState<{ id: string; name: string; settled: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  /** The boxes themselves are at fault (not, say, the terms version). */
  const [boxesInvalid, setBoxesInvalid] = useState(false);
  const form = useForm<ApplicationForm>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      applicantId: "",
      amount: "",
      tenorMonths: "",
      purpose: "",
      creditBureauCheck: false,
      dataProcessing: false,
    },
  });
  const errors = form.formState.errors;
  const options = useMemo(() => {
    const listed = applicants.data ?? [];
    return [...listed, ...added.filter((a) => !listed.some((l) => l.id === a.id))];
  }, [applicants.data, added]);
  const selected = options.find((a) => a.id === form.watch("applicantId"));
  // After the render that put the option in the select (so the value sticks) but before the
  // browser paints, so the select never shows "Choose an applicant" in between.
  useLayoutEffect(() => {
    if (!toSelect) return;
    if (options.some((a) => a.id === toSelect.id)) {
      form.setValue("applicantId", toSelect.id, { shouldValidate: true });
      setToSelect(null);
    } else if (toSelect.settled) {
      setToSelect(null);
      toast(`Could not load ${toSelect.name} into the list; try again or reload the page.`, "warn");
    }
  }, [toSelect, options, form, toast]);
  const indicative = useIndicativeRepayment(form.watch("amount"), form.watch("tenorMonths"));

  if (me.role !== "LOAN_OFFICER") {
    return (
      <>
        <PageHeader title="New application" />
        <p className="text-sm">Only a loan officer can capture applications.</p>
      </>
    );
  }

  const ask = (intent: Intent) =>
    form.handleSubmit((values) => {
      // The API refuses to submit without both consents; say so before the round trip.
      if (intent === "submit" && !(values.creditBureauCheck && values.dataProcessing)) {
        setConsentError(
          "Record both consents before submitting. A draft can be saved without them.",
        );
        setBoxesInvalid(true);
        return;
      }
      setConsentError(null);
      setBoxesInvalid(false);
      setPending({ intent, values });
    });

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const body: CreateCaseRequest = {
      applicantId: pending.values.applicantId,
      amount: toDecimalString(pending.values.amount),
      tenorMonths: Number.parseInt(pending.values.tenorMonths, 10),
      purpose: pending.values.purpose.trim(),
      submit: pending.intent === "submit",
      // Recorded when any consent is given, and always when submitting.
      ...(pending.intent === "submit" ||
      pending.values.creditBureauCheck ||
      pending.values.dataProcessing
        ? {
            consent: {
              creditBureauCheck: pending.values.creditBureauCheck,
              dataProcessing: pending.values.dataProcessing,
              termsVersion: CONSENT_TERMS_VERSION,
            },
          }
        : {}),
    };
    try {
      const created = await api<CaseDetail>("/cases", { method: "POST", body });
      toast(
        pending.intent === "submit"
          ? `Submitted ${created.reference} for decision`
          : `Saved draft ${created.reference}`,
      );
      router.push(`/cases/${created.id}`);
    } catch (e) {
      setBusy(false);
      // Field errors go next to their inputs: close the dialog so the officer can fix them.
      const all = fieldErrorsOf(e);
      const consentProblem = Object.entries(all).find(([name]) => name.startsWith("consent"));
      if (consentProblem) {
        setPending(null);
        setError(null);
        setConsentError(consentProblem[1]);
        setBoxesInvalid(consentProblem[0] === "consent");
        return;
      }
      const fields = Object.entries(all).filter(([name]) => isFormField(name));
      if (fields.length) {
        for (const [name, message] of fields) form.setError(name as FormField, { message });
        setPending(null);
        setError(null);
        toast(errorMessage(e), "warn");
        return;
      }
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="New application"
        description={`${productLabel(PRODUCT_CODE)} for a seeded applicant. Submitting runs the identity and sanctions checks, the credit bureau pull and the decision rules.`}
      />
      <LoadState
        loading={applicants.loading && !applicants.data}
        error={applicants.error}
        onRetry={applicants.reload}
      />
      {applicants.data && (
        <form
          className="grid gap-5 min-[1100px]:grid-cols-[2fr_1fr]"
          noValidate
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-5">
            <Card title="1 · Applicant">
              <Field label="Applicant" error={errors.applicantId?.message}>
                <Select
                  {...form.register("applicantId", {
                    // The officer's own choice wins over a selection still waiting for the list.
                    onChange: () => setToSelect(null),
                  })}
                >
                  <option value="">Choose an applicant</option>
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName} · {a.employer}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => setCapturing(true)}
                >
                  New or walk-in customer
                </Button>
              </div>
              {selected && (
                <KeyValues
                  className="mt-4"
                  items={[
                    { label: "Age", value: selected.ageYears },
                    { label: "Government ID", value: selected.governmentIdMasked, mono: true },
                    { label: "Monthly income", value: formatPeso(selected.monthlyIncome) },
                    {
                      label: "Monthly obligations",
                      value: formatPeso(selected.monthlyObligations),
                    },
                  ]}
                />
              )}
            </Card>
            <Card
              title="2 · Loan request"
              aside={`${productLabel(PRODUCT_CODE)} (${PRODUCT_CODE})`}
            >
              <FormGrid>
                <Field
                  label="Amount (pesos)"
                  hint={`${formatPeso(MIN_AMOUNT)} to ${formatPeso(MAX_AMOUNT)}`}
                  error={errors.amount?.message}
                >
                  <Input inputMode="decimal" autoComplete="off" {...form.register("amount")} />
                </Field>
                <Field
                  label="Tenor (months)"
                  hint="6 to 36 months"
                  error={errors.tenorMonths?.message}
                >
                  <Input inputMode="numeric" autoComplete="off" {...form.register("tenorMonths")} />
                </Field>
              </FormGrid>
              <div className="mt-4">
                <Field label="Purpose" error={errors.purpose?.message}>
                  <Input {...form.register("purpose")} />
                </Field>
              </div>
              <div className="mt-4">
                <IndicativeRepayment {...indicative} />
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-5">
            <Card title="Consent" aside={`Terms ${CONSENT_TERMS_VERSION}`}>
              <p className="text-sm text-mist-600">
                Captured on the applicant's behalf at the branch. Both are needed before the
                application is submitted: no consent, no credit bureau check.
              </p>
              <fieldset className="mt-3 flex flex-col gap-2.5">
                <legend className="sr-only">Applicant consents</legend>
                <Checkbox
                  label={CONSENT_LABEL.creditBureauCheck}
                  invalid={boxesInvalid && !form.watch("creditBureauCheck")}
                  {...form.register("creditBureauCheck", {
                    onChange: () => {
                      setConsentError(null);
                      setBoxesInvalid(false);
                    },
                  })}
                />
                <Checkbox
                  label={CONSENT_LABEL.dataProcessing}
                  invalid={boxesInvalid && !form.watch("dataProcessing")}
                  {...form.register("dataProcessing", {
                    onChange: () => {
                      setConsentError(null);
                      setBoxesInvalid(false);
                    },
                  })}
                />
              </fieldset>
              {consentError && (
                <p role="alert" className="mt-3 text-xs font-semibold text-bad-700">
                  {consentError}
                </p>
              )}
            </Card>
            <Card title="Submit">
              <p className="text-sm">
                Submitting runs the checks and the decision at once. Most applications are decided
                in seconds; a referred one goes to the work queue.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" type="button" onClick={ask("submit")}>
                  Submit for decision
                </Button>
                <Button variant="secondary" type="button" onClick={ask("draft")}>
                  Save draft
                </Button>
              </div>
            </Card>
          </div>
        </form>
      )}
      {capturing && (
        <NewApplicantDialog
          onCancel={() => setCapturing(false)}
          onChooseExisting={(id, name) => {
            setCapturing(false);
            // On file, but perhaps captured after this page loaded: refresh, then select.
            setToSelect({ id, name, settled: false });
            void applicants
              .reload()
              .then(() => setToSelect((t) => (t?.id === id ? { ...t, settled: true } : t)));
          }}
          onCreated={(a) => {
            setCapturing(false);
            setAdded((list) => [...list, a]);
            setToSelect({ id: a.id, name: a.fullName, settled: true });
            void applicants.reload();
            toast(`Added ${a.fullName} as a new applicant`);
          }}
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.intent === "submit"
            ? "Submit this application for decision?"
            : "Save this application as a draft?"
        }
        description={
          pending && (
            <>
              {selected?.fullName ?? "The applicant"} ·{" "}
              {formatPeso(toDecimalString(pending.values.amount))} over {pending.values.tenorMonths}{" "}
              months.{" "}
              {pending.intent === "submit"
                ? "The checks and the decision run now and cannot be undone."
                : "Nothing is checked until you submit it."}
            </>
          )
        }
        confirmLabel={pending?.intent === "submit" ? "Submit" : "Save draft"}
        variant="primary"
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
      />
    </>
  );
}
