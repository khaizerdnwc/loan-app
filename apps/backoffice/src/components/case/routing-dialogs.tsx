"use client";

import type { CaseDetail, LoanOfficerView, ReassignRequest } from "@loan/core";
import { ConfirmDialog, Field, FormStack, Select, Textarea } from "@loan/ui";
import { useState } from "react";
import { useApi } from "@/lib/use-api";

/**
 * Hand a case to another loan officer (PRD WF-002). It offers only the loan officers the API
 * would accept — every loan officer but the current owner, from `GET /loan-officers` with how
 * many open cases each owns — and preselects the least loaded. A reason is required.
 */
export function ReassignDialog({
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
  onSubmit: (body: ReassignRequest) => void;
}) {
  const officers = useApi<LoanOfficerView[]>("/loan-officers");
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [local, setLocal] = useState<Record<string, string>>({});
  const choices = (officers.data ?? [])
    .filter((o) => o.id !== detail.ownerId)
    .sort((a, b) => a.openCases - b.openCases || a.fullName.localeCompare(b.fullName));
  const ownerId = picked ?? choices[0]?.id ?? "";

  function submit() {
    const problems: Record<string, string> = {};
    if (!ownerId) problems.ownerId = "There is no other loan officer to hand the case to.";
    if (!reason.trim()) problems.reason = "Enter a reason for the reassignment.";
    setLocal(problems);
    if (Object.keys(problems).length) return;
    onSubmit({ ownerId, reason: reason.trim() });
  }

  const fieldError = (name: string) => local[name] ?? fieldErrors[name];

  return (
    <ConfirmDialog
      open
      title="Reassign this case?"
      description={`${detail.reference} for ${detail.applicant.fullName} is ${detail.ownerName ? `owned by ${detail.ownerName}` : "unassigned"}. The new owner finds it under Mine in their queue; the history records who handed it over and why.`}
      confirmLabel="Reassign"
      busy={busy || officers.loading}
      error={error ?? officers.error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <FormStack>
        <Field label="New owner" error={fieldError("ownerId")}>
          <Select value={ownerId} onChange={(e) => setPicked(e.target.value)}>
            {choices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName} · {o.openCases} open {o.openCases === 1 ? "case" : "cases"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason" error={fieldError("reason")}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </FormStack>
    </ConfirmDialog>
  );
}
