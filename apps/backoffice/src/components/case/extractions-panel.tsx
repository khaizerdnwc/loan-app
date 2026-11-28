"use client";

import {
  type CaseExtractionLine,
  type CaseExtractionsView,
  DOCUMENT_TYPE_LABEL,
  type DocumentExtractionView,
  EXTRACTION_FLAG_LABEL,
  type ExtractionFlag,
  ProblemCode,
} from "@loan/core";
import {
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  formatDateTime,
  formatNumber,
  formatPeso,
  KeyValues,
  SimulatedLabel,
  useToast,
} from "@loan/ui";
import { useEffect, useState } from "react";
import { LoadState } from "@/components/load-state";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** Refusals that mean the case or document moved on: re-read and close the dialog. */
const STALE = new Set<string>([ProblemCode.InvalidTransition, ProblemCode.NotFound]);

/**
 * OCR and bank statement analysis on the case's received documents (PRD DOC-002, DOC-007; the
 * prototype's "Bank statement analysis" card and OCR mismatch flag). The loan officer runs OCR
 * on a document the borrower uploaded; the reading shows what the document says, compared with
 * the application, with anything that disagrees flagged. It informs the review and never
 * changes the decision. Every reading is simulated. `version` re-reads it when the case changes.
 */
export function ExtractionsPanel({
  caseId,
  version,
  onChanged,
}: {
  caseId: string;
  version: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const loaded = useApi<CaseExtractionsView>(`/cases/${caseId}/extractions`);
  const [data, setData] = useState<CaseExtractionsView | null>(null);
  const [open, setOpen] = useState<CaseExtractionLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reload } = loaded;

  useEffect(() => {
    if (loaded.data) setData(loaded.data);
  }, [loaded.data]);
  useEffect(() => {
    if (version > 0) void reload();
  }, [version, reload]);

  const uploaded = (data?.lines ?? []).filter((l) => l.uploadReference);

  async function extract() {
    if (!open) return;
    const name = DOCUMENT_TYPE_LABEL[open.documentType];
    setBusy(true);
    setError(null);
    try {
      const next = await api<CaseExtractionsView>(
        `/cases/${caseId}/documents/${open.documentType}/extract`,
        { method: "POST" },
      );
      const flags = next.lines.find((l) => l.documentType === open.documentType)?.extraction?.flags
        .length;
      toast(
        flags
          ? `${name} read — ${formatNumber(flags)} flag${flags === 1 ? "" : "s"} to check`
          : `${name} read — matches the application`,
        flags ? "warn" : undefined,
      );
      setData(next);
      setOpen(null);
      onChanged();
    } catch (e) {
      // The document or case moved on since it was loaded: show it as it is now and close, so
      // the dialog never offers a reading the refreshed case no longer allows.
      if (e instanceof ApiError && STALE.has(e.code)) {
        toast(errorMessage(e), "warn");
        setOpen(null);
        void reload();
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Extracted data (OCR)" aside={<SimulatedLabel what="OCR and statement analysis" />}>
      {!data ? (
        <LoadState loading={loaded.loading} error={loaded.error} onRetry={loaded.reload} />
      ) : uploaded.length === 0 ? (
        <EmptyState title="No document has been received yet." />
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft" aria-label="OCR readings">
          {uploaded.map((line) => (
            <li key={line.documentType} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-900">{DOCUMENT_TYPE_LABEL[line.documentType]}</span>
                {!line.extraction && line.extract?.enabled && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Read with OCR: ${DOCUMENT_TYPE_LABEL[line.documentType]}`}
                    onClick={() => {
                      setError(null);
                      setOpen(line);
                    }}
                  >
                    Read with OCR
                  </Button>
                )}
              </div>
              {line.extraction ? (
                <Reading reading={line.extraction} />
              ) : (
                <p className="mt-1 text-xs text-mist-500">
                  {line.extract && !line.extract.enabled
                    ? line.extract.detail
                    : "Not read with OCR yet."}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ConfirmDialog
          open
          title={`Read ${DOCUMENT_TYPE_LABEL[open.documentType]} with OCR?`}
          description="OCR is simulated: it reads the figures the synthetic document shows and compares them with the application. The reading is recorded in the history; it does not change the decision or the case's status. If OCR cannot answer, nothing is recorded and you verify the document by eye."
          confirmLabel="Read with OCR"
          busy={busy}
          error={error}
          onConfirm={extract}
          onCancel={() => setOpen(null)}
        />
      )}
    </Card>
  );
}

function Reading({ reading: r }: { reading: DocumentExtractionView }) {
  const describe = (flag: ExtractionFlag): string => {
    if (flag === "INCOME_MISMATCH" && r.monthlyIncome) {
      return `${EXTRACTION_FLAG_LABEL[flag]}: ${formatPeso(r.monthlyIncome)} read, ${formatPeso(r.compared.monthlyIncome)} on the application`;
    }
    if (flag === "EMPLOYER_MISMATCH" && r.employer) {
      return `${EXTRACTION_FLAG_LABEL[flag]}: "${r.employer}" read, "${r.compared.employer}" on the application`;
    }
    if (flag === "OBLIGATIONS_HIGHER" && r.statement) {
      return `${EXTRACTION_FLAG_LABEL[flag]}: ${formatPeso(r.statement.recurringObligations)} a month, ${formatPeso(r.compared.monthlyObligations)} on record`;
    }
    return EXTRACTION_FLAG_LABEL[flag];
  };
  return (
    <div className="mt-2 flex flex-col gap-3">
      <KeyValues
        items={[
          {
            label: "Monthly income read",
            value: r.monthlyIncome
              ? formatPeso(r.monthlyIncome)
              : "OCR found no income figure on it",
          },
          { label: "Employer read", value: r.employer ?? "OCR found no employer on it" },
          { label: "Reading", value: r.reference, mono: true },
        ]}
      />
      {r.statement && (
        <div>
          <h3 className="mb-2 text-2xs font-bold tracking-wider text-mist-500 uppercase">
            Bank statement analysis
          </h3>
          <KeyValues
            items={[
              {
                label: "Salary credits",
                value: `${formatPeso(r.statement.salaryCredit)} monthly, ${formatNumber(r.statement.monthsWithSalary)} of ${formatNumber(r.statement.monthsCovered)} months`,
              },
              {
                label: "Recurring obligations",
                value: `${formatPeso(r.statement.recurringObligations)} monthly`,
              },
              {
                label: "Average daily balance",
                value: formatPeso(r.statement.averageDailyBalance),
              },
              {
                label: "Returned items",
                value:
                  r.statement.returnedItems === 0
                    ? "None"
                    : formatNumber(r.statement.returnedItems),
              },
              {
                label: "Gambling or lending apps",
                value: r.statement.riskyMerchants ? "Found" : "None detected",
              },
            ]}
          />
        </div>
      )}
      {r.flags.length > 0 ? (
        <Callout tone="warn" lead="OCR flagged:">
          {r.flags.map(describe).join("; ")}. Check the document before you verify it.
        </Callout>
      ) : (
        <p className="text-xs text-mist-500">Matches the application.</p>
      )}
      <p className="text-xs text-mist-500">
        Read by {r.extractedByName}, {formatDateTime(r.extractedAt)}
      </p>
    </div>
  );
}
