"use client";

import { PageHeader } from "@/components/app-shell";
import { PreCheckForm } from "@/components/eligibility/pre-check-form";
import { ModuleOff } from "@/components/module-off";
import { useFeature } from "@/lib/features";

/**
 * Eligibility pre-check (PRD PC-008): the loan officer checks stated figures first. A module
 * the bank can switch off (PLT-006): then the page says so, with no form.
 */
export default function EligibilityPage() {
  const on = useFeature("ELIGIBILITY_PRECHECK");
  return (
    <>
      <PageHeader
        title="Eligibility pre-check"
        description="Check the figures a customer states against the lending policy before starting an application. Indicative only: nothing is stored, no consent is needed, and no bureau or screening is run."
      />
      {on === false ? <ModuleOff flag="ELIGIBILITY_PRECHECK" /> : <PreCheckForm />}
    </>
  );
}
