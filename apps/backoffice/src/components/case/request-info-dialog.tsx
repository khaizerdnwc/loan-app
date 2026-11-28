"use client";

import {
  type CaseDetail,
  DOCUMENT_TYPE_LABEL,
  type DocumentType,
  type InfoRequestRequest,
} from "@loan/core";
import { Checkbox, ConfirmDialog, Field, FormStack, Select, Textarea } from "@loan/ui";
import { useState } from "react";

/**
 * The prototype's "Request information from the borrower" dialog (PRD WF-007): which
 * documents, the message the borrower sees, and when it is due. It offers exactly the
 * document types the API lists on the REQUEST_INFO action (one rule, decided by the API).
 */
export function RequestInfoDialog({
  detail,
  offered,
  busy,
  error,
  fieldErrors,
  onCancel,
  onSubmit,
}: {
  detail: CaseDetail;
  /** The document types the API will accept now (`documentTypes` on REQUEST_INFO). */
  offered: DocumentType[];
  busy: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onCancel: () => void;
  onSubmit: (body: InfoRequestRequest) => void;
}) {
  const [picked, setPicked] = useState<DocumentType[]>(offered.slice(0, 1));
  const firstName = detail.applicant.fullName.split(" ")[0] ?? detail.applicant.fullName;
  const [message, setMessage] = useState(
    `Hi ${firstName}, to complete your loan review please upload the documents listed in your WhiteBank app.`,
  );
  const [dueInDays, setDueInDays] = useState<3 | 5>(3);
  const [local, setLocal] = useState<Record<string, string>>({});

  function submit() {
    const problems: Record<string, string> = {};
    if (!picked.length) problems.documents = "Pick at least one document to request.";
    if (!message.trim()) problems.message = "Write the message the borrower sees.";
    setLocal(problems);
    if (Object.keys(problems).length) return;
    onSubmit({ documents: picked, message: message.trim(), dueInDays });
  }

  const fieldError = (name: string) => local[name] ?? fieldErrors[name];

  return (
    <ConfirmDialog
      open
      title="Request information from the borrower"
      description={`${detail.applicant.fullName} is asked for the documents below (the borrower side is simulated). The case waits until they arrive; you can still withdraw it.`}
      confirmLabel="Send request"
      busy={busy}
      error={error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <FormStack>
        <fieldset className="flex flex-col gap-2.5">
          {/* The one form label style (Field's): small, uppercase, tracked. */}
          <legend className="mb-1.5 text-2xs font-bold tracking-wider text-mist-500 uppercase">
            Documents
          </legend>
          {offered.map((type) => (
            <Checkbox
              key={type}
              label={DOCUMENT_TYPE_LABEL[type]}
              checked={picked.includes(type)}
              invalid={Boolean(fieldError("documents")) && !picked.length}
              onChange={(e) => {
                const on = e.target.checked;
                setPicked((p) => (on ? [...p, type] : p.filter((t) => t !== type)));
              }}
            />
          ))}
          {fieldError("documents") && (
            <p role="alert" className="text-xs font-semibold text-bad-700">
              {fieldError("documents")}
            </p>
          )}
        </fieldset>
        <Field label="Message the borrower sees" error={fieldError("message")}>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field label="Due" error={fieldError("dueInDays")}>
          <Select
            value={String(dueInDays)}
            onChange={(e) => setDueInDays(e.target.value === "5" ? 5 : 3)}
          >
            <option value="3">In 3 days</option>
            <option value="5">In 5 days</option>
          </Select>
        </Field>
      </FormStack>
    </ConfirmDialog>
  );
}
