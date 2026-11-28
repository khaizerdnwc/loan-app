"use client";

import type { EligibilityOutcome, EligibilityPreCheckView } from "@loan/core";
import {
  Button,
  Callout,
  Card,
  Field,
  FormGrid,
  formatAmountsInText,
  formatMonthlyRate,
  formatPeso,
  Input,
  Pill,
  type Tone,
} from "@loan/ui";
import { type FormEvent, useState } from "react";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";
import {
  MAX_AMOUNT,
  MAX_TENOR,
  MIN_AMOUNT,
  MIN_TENOR,
  toCentavos,
  toDecimalString,
} from "@/lib/application-schema";

type Form = {
  amount: string;
  tenorMonths: string;
  ageYears: string;
  monthlyIncome: string;
  monthlyObligations: string;
};

/**
 * The same limits the API enforces (product amount and tenor), checked first in staff words
 * so a typo never costs a round trip. The API stays the authority.
 */
function validate(f: Form): Record<string, string> {
  const errors: Record<string, string> = {};
  const amount = toCentavos(f.amount);
  if (!f.amount.trim()) errors.amount = "Enter the amount.";
  else if (amount === null) errors.amount = "Enter an amount in pesos, e.g. 150000.";
  else if (amount < (toCentavos(MIN_AMOUNT) ?? 0n) || amount > (toCentavos(MAX_AMOUNT) ?? 0n)) {
    errors.amount = `The amount must be between ${formatPeso(MIN_AMOUNT)} and ${formatPeso(MAX_AMOUNT)}.`;
  }
  const tenor = f.tenorMonths.trim();
  if (!tenor) errors.tenorMonths = "Enter the tenor.";
  else if (!/^\d+$/.test(tenor)) errors.tenorMonths = "Enter a whole number of months.";
  else if (Number(tenor) < MIN_TENOR || Number(tenor) > MAX_TENOR) {
    errors.tenorMonths = `The tenor must be ${MIN_TENOR} to ${MAX_TENOR} months.`;
  }
  const age = f.ageYears.trim();
  if (!age) errors.ageYears = "Enter the applicant's age.";
  else if (!/^\d{1,3}$/.test(age)) errors.ageYears = "Enter the age in whole years.";
  if (!f.monthlyIncome.trim()) errors.monthlyIncome = "Enter the monthly income.";
  else if (toCentavos(f.monthlyIncome) === null) {
    errors.monthlyIncome = "Enter an amount in pesos, e.g. 78000.";
  }
  if (f.monthlyObligations.trim() && toCentavos(f.monthlyObligations) === null) {
    errors.monthlyObligations = "Enter an amount in pesos, or leave it empty for none.";
  }
  return errors;
}

/** The engine's affordable figure: "None" in words when nothing is affordable, never ₱0.00. */
function affordableText(amount: string): string {
  return amount === "0.00" ? "None" : formatPeso(amount);
}

const OUTCOME: Record<EligibilityOutcome, { label: string; tone: Tone; meaning: string }> = {
  LIKELY_ELIGIBLE: {
    label: "Likely eligible",
    tone: "ok",
    meaning: "Nothing in the policy stands in the way of these figures.",
  },
  REVIEW_LIKELY: {
    label: "Review likely",
    tone: "warn",
    meaning: "An application on these figures would probably go to a loan officer for review.",
  },
  NOT_ELIGIBLE: {
    label: "Not eligible",
    tone: "bad",
    meaning: "These figures fail a policy rule; an application would most likely be declined.",
  },
};

const RESULT: Record<"PASS" | "FAIL" | "REVIEW", { label: string; tone: Tone }> = {
  PASS: { label: "Pass", tone: "ok" },
  REVIEW: { label: "Review", tone: "warn" },
  FAIL: { label: "Fail", tone: "bad" },
};

/**
 * The eligibility pre-check (PRD PC-008): the loan officer enters the figures a walk-in states
 * and sees what the policy says before an application, consent or bureau pull. Indicative
 * only; nothing is stored, so there is nothing to confirm.
 */
export function PreCheckForm() {
  const [form, setForm] = useState<Form>({
    amount: "",
    tenorMonths: "",
    ageYears: "",
    monthlyIncome: "",
    monthlyObligations: "",
  });
  const [result, setResult] = useState<EligibilityPreCheckView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = (key: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const local = validate(form);
    setFields(local);
    if (Object.keys(local).length > 0) {
      setResult(null);
      return;
    }
    setBusy(true);
    try {
      setResult(
        await api<EligibilityPreCheckView>("/eligibility/pre-check", {
          method: "POST",
          body: {
            amount: toDecimalString(form.amount),
            tenorMonths: Number.parseInt(form.tenorMonths, 10),
            ageYears: Number.parseInt(form.ageYears, 10),
            monthlyIncome: toDecimalString(form.monthlyIncome),
            monthlyObligations: form.monthlyObligations.trim()
              ? toDecimalString(form.monthlyObligations)
              : "0.00",
          },
        }),
      );
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
      setFields(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  }

  const outcome = result ? OUTCOME[result.outcome] : null;
  return (
    <div className="grid gap-4 min-[1100px]:grid-cols-2">
      <Card title="Stated figures">
        <form onSubmit={submit} noValidate>
          <FormGrid>
            <Field label="Amount (pesos)" error={fields.amount}>
              <Input inputMode="decimal" value={form.amount} onChange={set("amount")} />
            </Field>
            <Field label="Tenor (months)" error={fields.tenorMonths}>
              <Input inputMode="numeric" value={form.tenorMonths} onChange={set("tenorMonths")} />
            </Field>
            <Field label="Age (years)" error={fields.ageYears}>
              <Input inputMode="numeric" value={form.ageYears} onChange={set("ageYears")} />
            </Field>
            <Field label="Monthly income (pesos)" error={fields.monthlyIncome}>
              <Input
                inputMode="decimal"
                value={form.monthlyIncome}
                onChange={set("monthlyIncome")}
              />
            </Field>
            <Field
              label="Monthly obligations (pesos)"
              hint="Existing loan and card repayments; leave empty for none."
              error={fields.monthlyObligations}
            >
              <Input
                inputMode="decimal"
                value={form.monthlyObligations}
                onChange={set("monthlyObligations")}
              />
            </Field>
          </FormGrid>
          {error && (
            <Callout tone="bad" alert className="mt-4">
              {error}
            </Callout>
          )}
          <div className="mt-4">
            <Button type="submit" variant="primary" busy={busy}>
              Check eligibility
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Pre-check result"
        aside={outcome ? <Pill tone={outcome.tone}>{outcome.label}</Pill> : undefined}
      >
        {!result || !outcome ? (
          <p className="text-sm text-mist-500">
            Enter the applicant&apos;s figures and check them against the policy. Nothing is stored
            and no bureau is checked.
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <p>{outcome.meaning}</p>
            <ul aria-label="Policy checks" className="flex flex-col divide-y divide-line">
              {result.checks.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2">
                    <Pill tone={RESULT[c.result].tone}>{RESULT[c.result].label}</Pill>
                    {c.name}
                  </span>
                  <span className="text-right text-xs text-mist-500">
                    {formatAmountsInText(c.value)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              <dt className="text-mist-500">Monthly rate, by grade</dt>
              <dd className="text-right">
                {formatMonthlyRate(result.monthlyRateRange.from)} to{" "}
                {formatMonthlyRate(result.monthlyRateRange.to)}
              </dd>
              {result.affordable && (
                <>
                  <dt className="text-mist-500">Affordable amount (engine), best grade rate</dt>
                  <dd className="text-right">{affordableText(result.affordable.atBestRate)}</dd>
                  <dt className="text-mist-500">Affordable amount (engine), highest grade rate</dt>
                  <dd className="text-right">{affordableText(result.affordable.atWorstRate)}</dd>
                </>
              )}
            </dl>
            {result.affordable && (
              <p className="text-xs text-mist-500">
                {result.affordable.atBestRate === "0.00"
                  ? `Nothing is affordable at any grade's rate within the debt-service limit of ${result.ruleSetVersion}; an application would go to a loan officer for review.`
                  : `Indicative: the most these figures can repay within the debt-service limit of ${result.ruleSetVersion}, up to the amount asked. Not an offer.`}
              </p>
            )}
            <Callout tone="info" lead="Indicative.">
              {result.caveat} Policy {result.ruleSetVersion}.
            </Callout>
          </div>
        )}
      </Card>
    </div>
  );
}
