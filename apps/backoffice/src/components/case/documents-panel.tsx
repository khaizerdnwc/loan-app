"use client";

import {
  type CaseDetail,
  type CaseDocumentView,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  type DocumentAction,
  type DocumentReviewRequest,
  type DocumentStatus,
  ProblemCode,
} from "@loan/core";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  formatDate,
  formatDateTime,
  formatNumber,
  Pill,
  SimulatedLabel,
  Textarea,
  type Tone,
  useToast,
} from "@loan/ui";
import { useState } from "react";
import { useShellRefresh } from "@/components/app-shell";
import { ApiError, api, errorMessage } from "@/lib/api";
import { isOverdue } from "@/lib/info-request";

const STATUS_TONE: Record<DocumentStatus, Tone> = {
  REQUESTED: "warn",
  RECEIVED: "info",
  VERIFIED: "ok",
  REJECTED: "bad",
};

/** Refusals that mean the case moved on since it was loaded: re-read it and close the dialog. */
const STALE = new Set<string>([ProblemCode.InvalidTransition, ProblemCode.NotFound]);

type Open = { action: DocumentAction; doc: CaseDocumentView } | null;

/**
 * The case's document checklist (PRD DOC-003; the prototype's Documents card): what was asked
 * of the borrower, what arrived through the simulated upload, and the loan officer's verdict.
 * Each document offers only the actions the API lists for it.
 */
export function DocumentsPanel({
  detail,
  onChanged,
}: {
  detail: CaseDetail;
  onChanged: (next: CaseDetail) => void;
}) {
  const toast = useToast();
  const refreshShell = useShellRefresh();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const request = detail.infoRequest;

  function start(action: DocumentAction, doc: CaseDocumentView) {
    setError(null);
    setReason("");
    setReasonError(null);
    setOpen({ action, doc });
  }

  async function confirm() {
    if (!open) return;
    const { action, doc } = open;
    const name = DOCUMENT_TYPE_LABEL[doc.type];
    if (action === "REJECT" && !reason.trim()) {
      setReasonError("Enter what is wrong with the document.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next =
        action === "SIMULATE_UPLOAD"
          ? await api<CaseDetail>(`/cases/${detail.id}/documents/${doc.type}/upload`, {
              method: "POST",
            })
          : await api<CaseDetail>(`/cases/${detail.id}/documents/${doc.type}/review`, {
              method: "POST",
              body: {
                decision: action === "VERIFY" ? "VERIFIED" : "REJECTED",
                reason: action === "REJECT" ? reason.trim() : undefined,
              } satisfies DocumentReviewRequest,
            });
      toast(
        action === "SIMULATE_UPLOAD"
          ? next.status === "REVIEW"
            ? `${name} received — every requested document is in; back to review`
            : `${name} received`
          : action === "VERIFY"
            ? `${name} verified`
            : `${name} rejected`,
      );
      setOpen(null);
      onChanged(next);
      refreshShell();
    } catch (e) {
      // The case moved on since it was loaded: show it as it is now, and close the dialog so it
      // never offers an action the refreshed case no longer lists.
      if (e instanceof ApiError && STALE.has(e.code)) {
        toast(errorMessage(e), "warn");
        setOpen(null);
        api<CaseDetail>(`/cases/${detail.id}`).then(onChanged, () =>
          toast("Reload the page to see the case's current documents.", "warn"),
        );
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Documents" aside={<SimulatedLabel what="borrower uploads" />}>
      {request && (
        <div className="mb-4 text-sm">
          <p>
            Requested by <strong className="text-ink-900">{request.requestedByName}</strong> on{" "}
            {formatDateTime(request.requestedAt)} · due {formatDate(request.dueOn)}
            {detail.status === "INFO_REQUESTED" && isOverdue(request.dueOn) && (
              <>
                {" "}
                <Pill tone="bad">Overdue</Pill>
              </>
            )}
          </p>
          <p className="mt-1 text-mist-600">“{request.message}”</p>
        </div>
      )}
      {detail.documents.length === 0 ? (
        <EmptyState title="No documents requested yet." />
      ) : (
        <ul className="flex flex-col divide-y divide-line" aria-label="Document checklist">
          {detail.documents.map((doc) => (
            <li key={doc.type} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-900">{DOCUMENT_TYPE_LABEL[doc.type]}</span>
                  <Pill tone={STATUS_TONE[doc.status]}>{DOCUMENT_STATUS_LABEL[doc.status]}</Pill>
                </p>
                {doc.upload && (
                  <p className="mt-1 text-xs text-mist-500">
                    {doc.upload.fileName} · {formatNumber(Math.round(doc.upload.sizeBytes / 1024))}{" "}
                    KB · {doc.upload.pages} {doc.upload.pages === 1 ? "page" : "pages"} · scanned
                    clean · received {formatDateTime(doc.upload.receivedAt)} ·{" "}
                    <span className="font-mono">{doc.upload.reference}</span>
                  </p>
                )}
                {doc.review && (
                  <p
                    className={`mt-1 text-xs ${doc.status === "REJECTED" ? "text-bad-700" : "text-mist-500"}`}
                  >
                    {doc.status === "REJECTED" ? "Rejected" : "Verified"} by {doc.review.byName},{" "}
                    {formatDateTime(doc.review.at)}
                    {doc.review.rejectionReason && `: ${doc.review.rejectionReason}`}
                  </p>
                )}
                {doc.status === "REQUESTED" && (
                  <p className="mt-1 text-xs text-mist-500">
                    Waiting for the borrower to upload it.
                  </p>
                )}
              </div>
              {doc.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {doc.actions.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant="secondary"
                      aria-label={`${ACTION_LABEL[action]}: ${DOCUMENT_TYPE_LABEL[doc.type]}`}
                      onClick={() => start(action, doc)}
                    >
                      {ACTION_LABEL[action]}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ConfirmDialog
          open
          title={TITLE[open.action](DOCUMENT_TYPE_LABEL[open.doc.type])}
          description={DESCRIBE[open.action](detail.applicant.fullName)}
          confirmLabel={ACTION_LABEL[open.action]}
          variant={open.action === "REJECT" ? "danger" : "primary"}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => setOpen(null)}
        >
          {open.action === "REJECT" && (
            <Field label="What is wrong with it" error={reasonError ?? undefined}>
              <Textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim()) setReasonError(null);
                }}
              />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </Card>
  );
}

const ACTION_LABEL: Record<DocumentAction, string> = {
  SIMULATE_UPLOAD: "Simulate borrower upload",
  VERIFY: "Verify",
  REJECT: "Reject",
};

const TITLE: Record<DocumentAction, (name: string) => string> = {
  SIMULATE_UPLOAD: (name) => `Simulate the borrower uploading ${name}?`,
  VERIFY: (name) => `Verify ${name}?`,
  REJECT: (name) => `Reject ${name}?`,
};

const DESCRIBE: Record<DocumentAction, (applicant: string) => string> = {
  SIMULATE_UPLOAD: (applicant) =>
    `The borrower side is simulated: a synthetic PDF is recorded as uploaded by ${applicant} in the WhiteBank app and scanned. Only its details are kept, never a file.`,
  VERIFY: () =>
    "You confirm the document is genuine and supports the application. This is recorded in the history.",
  REJECT: () =>
    "The document stays on the case as rejected, with your reason. You can then ask the borrower for it again.",
};
