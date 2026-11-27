"use client";

import type { IndicativeRepaymentView } from "@loan/core";
import { Callout, formatMonthlyRate, formatPeso, SimulatedLabel } from "@loan/ui";

/**
 * The indicative monthly repayment before a decision (PRD INT-004; prototype "at grade C
 * pricing · calculated by core"). Core banking quotes it; when core cannot answer it says
 * so, and nothing else on the page depends on it. `error` is a failure that is not core's
 * (the request itself failed), shown in the API client's words.
 */
export function IndicativeRepayment({
  quote,
  loading = false,
  error = null,
}: {
  quote: IndicativeRepaymentView | null;
  loading?: boolean;
  error?: string | null;
}) {
  const note = loading
    ? null
    : error
      ? error
      : !quote
        ? null
        : quote.status === "QUOTED"
          ? `At grade ${quote.grade} pricing (${formatMonthlyRate(quote.monthlyRate)}) · calculated by core. Indicative only, not an offer: the decision sets the grade and the rate.`
          : "Core banking (simulated) could not quote it just now; it is asked again when the terms change or the page is opened again. This does not affect saving or submitting the application.";
  return (
    <div data-testid="indicative-repayment">
      <Callout tone="neutral">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Indicative monthly repayment</span>
          <span aria-live="polite" data-testid="indicative-value">
            {loading ? (
              <span className="text-mist-500">Calculating…</span>
            ) : error ? (
              <strong className="text-ink-900">Unavailable</strong>
            ) : !quote ? (
              <span className="text-mist-500">Shown once the amount and tenor are valid</span>
            ) : quote.status === "QUOTED" ? (
              <strong className="text-ink-900">{formatPeso(quote.regularInstalment)}</strong>
            ) : (
              <strong className="text-ink-900">Unavailable</strong>
            )}
          </span>
          <SimulatedLabel what="core banking" />
        </p>
        {note && <p className="mt-1 text-xs text-mist-500">{note}</p>}
      </Callout>
    </div>
  );
}
