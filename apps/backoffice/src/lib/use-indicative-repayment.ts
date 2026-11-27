"use client";

import { type IndicativeRepaymentView, ProblemCode } from "@loan/core";
import { useEffect, useState } from "react";
import { ApiError, api, errorMessage } from "./api";
import { applicationSchema, toDecimalString } from "./application-schema";

/** The API path for an indicative quote of these form values, or null while they are invalid. */
export function indicativeQuotePath(amount: string, tenorMonths: string): string | null {
  const { amount: amountRule, tenorMonths: tenorRule } = applicationSchema.shape;
  if (!amountRule.safeParse(amount).success || !tenorRule.safeParse(tenorMonths).success) {
    return null;
  }
  const query = new URLSearchParams({
    amount: toDecimalString(amount),
    tenorMonths: String(Number.parseInt(tenorMonths, 10)),
  });
  return `/products/PL/quote?${query.toString()}`;
}

export interface IndicativeState {
  quote: IndicativeRepaymentView | null;
  loading: boolean;
  /** The request failed for a reason that is not core banking's (offline, session ended). */
  error: string | null;
}

/**
 * Core banking's indicative repayment for the terms being typed (PRD INT-004), fetched once
 * the officer pauses for `delayMs`. A reply for terms that have since changed is dropped. The
 * API answers 200 UNAVAILABLE when core cannot quote; any other failure is shown in the API
 * client's words. The form never breaks on it.
 */
export function useIndicativeRepayment(
  amount: string,
  tenorMonths: string,
  delayMs = 400,
): IndicativeState {
  const path = indicativeQuotePath(amount, tenorMonths);
  const [state, setState] = useState<{
    path: string | null;
    quote: IndicativeRepaymentView | null;
    error: string | null;
  }>({ path: null, quote: null, error: null });

  useEffect(() => {
    if (path === null) return;
    let live = true;
    const timer = setTimeout(() => {
      api<IndicativeRepaymentView>(path).then(
        (quote) => {
          if (live) setState({ path, quote, error: null });
        },
        (e: unknown) => {
          if (!live) return;
          const coreDown = e instanceof ApiError && e.code === ProblemCode.ProviderUnavailable;
          setState({
            path,
            quote: null,
            error: coreDown
              ? "Core banking (simulated) is not answering. This does not affect saving or submitting the application."
              : errorMessage(e),
          });
        },
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, delayMs]);

  if (path === null) return { quote: null, loading: false, error: null };
  if (state.path !== path) return { quote: null, loading: true, error: null };
  return { quote: state.quote, loading: false, error: state.error };
}
