"use client";

import { PageHeader } from "@/components/app-shell";
import { PreCheckForm } from "@/components/eligibility/pre-check-form";

/** Eligibility pre-check (PRD PC-008): the loan officer checks stated figures first. */
export default function EligibilityPage() {
  return (
    <>
      <PageHeader
        title="Eligibility pre-check"
        description="Check the figures a customer states against the lending policy before starting an application. Indicative only: nothing is stored, no consent is needed, and no bureau or screening is run."
      />
      <PreCheckForm />
    </>
  );
}
