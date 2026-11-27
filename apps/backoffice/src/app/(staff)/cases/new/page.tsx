"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ApplicantView,
  type CaseDetail,
  type CreateCaseRequest,
  productLabel,
} from "@loan/core";

/** The one product this release captures. */
const PRODUCT_CODE = "PL";

import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  FormGrid,
  formatPeso,
  Input,
  Select,
  useToast,
} from "@loan/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";
import {
  type ApplicationForm,
  applicationSchema,
  MAX_AMOUNT,
  MIN_AMOUNT,
  toDecimalString,
} from "@/lib/application-schema";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

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
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ApplicationForm>({
    resolver: zodResolver(applicationSchema),
    defaultValues: { applicantId: "", amount: "", tenorMonths: "", purpose: "" },
  });
  const errors = form.formState.errors;
  const selected = applicants.data?.find((a) => a.id === form.watch("applicantId"));

  if (me.role !== "LOAN_OFFICER") {
    return (
      <>
        <PageHeader title="New application" />
        <p className="text-sm">Only a loan officer can capture applications.</p>
      </>
    );
  }

  const ask = (intent: Intent) => form.handleSubmit((values) => setPending({ intent, values }));

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
      const fields = Object.entries(fieldErrorsOf(e)).filter(([name]) => isFormField(name));
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
                <Select {...form.register("applicantId")}>
                  <option value="">Choose an applicant</option>
                  {applicants.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName} · {a.employer}
                    </option>
                  ))}
                </Select>
              </Field>
              {selected && (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-mist-500">Age</dt>
                    <dd className="text-ink-900">{selected.ageYears}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-mist-500">Government ID</dt>
                    <dd className="font-mono text-ink-900">{selected.governmentIdMasked}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-mist-500">Monthly income</dt>
                    <dd className="text-ink-900">{formatPeso(selected.monthlyIncome)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-mist-500">Monthly obligations</dt>
                    <dd className="text-ink-900">{formatPeso(selected.monthlyObligations)}</dd>
                  </div>
                </dl>
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
            </Card>
          </div>
          <Card title="Submit">
            <p className="text-sm">
              Submitting runs the checks and the decision at once. Most applications are decided in
              seconds; a referred one goes to the work queue.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="accent" type="button" onClick={ask("submit")}>
                Submit for decision
              </Button>
              <Button variant="secondary" type="button" onClick={ask("draft")}>
                Save draft
              </Button>
            </div>
          </Card>
        </form>
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
        variant={pending?.intent === "submit" ? "accent" : "primary"}
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
