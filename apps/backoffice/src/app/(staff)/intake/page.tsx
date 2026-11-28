"use client";

import {
  EXTRACTION_FLAG_LABEL,
  INTAKE_DRAFT_STATUS_LABEL,
  INTAKE_SAMPLE_FILES,
  type IntakeDraftStatus,
  type IntakeDraftView,
  type IntakeSource,
  type IntakeUploadView,
  productLabel,
} from "@loan/core";
import {
  Button,
  Callout,
  Card,
  type Column,
  ConfirmDialog,
  Field,
  formatNumber,
  formatPeso,
  Pill,
  SegmentedFilter,
  Select,
  SimulatedLabel,
  Table,
  type Tone,
  useToast,
} from "@loan/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader, useShellRefresh } from "@/components/app-shell";
import { ReviewDraftDialog } from "@/components/intake/review-draft-dialog";
import { LoadState } from "@/components/load-state";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const STATUS_TONE: Record<IntakeDraftStatus, Tone> = {
  PENDING_REVIEW: "warn",
  CONFIRMED: "ok",
  DISCARDED: "neutral",
};

const UPLOAD: Record<IntakeSource, { button: string; title: string; file: string }> = {
  PARTNER_SPREADSHEET: {
    button: "Upload partner spreadsheet",
    title: "Upload the partner spreadsheet?",
    file: "a payroll partner's spreadsheet of loan requests",
  },
  EMAIL_BUNDLE: {
    button: "Upload email bundle",
    title: "Upload the email bundle?",
    file: "an emailed bundle with an application form, a government ID and a payslip",
  },
};

const isPending = (d: IntakeDraftView) => d.status === "PENDING_REVIEW";

/**
 * Email and file intake (PRD INT-010, F4; the prototype's Email and file intake screen). A
 * loan officer uploads an emailed bundle or a partner's spreadsheet (synthetic files, the
 * upload and OCR simulated); OCR extracts each application into a draft for review. Nothing is
 * submitted here: a confirmed draft becomes an application draft the officer completes and
 * submits from the case. Compliance reads the list. The filter lives in the URL (`?view=all`).
 */
export default function IntakePage() {
  return (
    <Suspense fallback={null}>
      <Intake />
    </Suspense>
  );
}

function Intake() {
  const me = useSession();
  const router = useRouter();
  const toast = useToast();
  const refreshShell = useShellRefresh();
  const view = useSearchParams().get("view") === "all" ? "all" : "pending";
  const setView = (next: "pending" | "all") =>
    router.replace(next === "all" ? "/intake?view=all" : "/intake", { scroll: false });
  const list = useApi<IntakeDraftView[]>("/intake/drafts?view=all");
  const [uploading, setUploadingSource] = useState<IntakeSource | null>(null);
  const [sampleFile, setSampleFile] = useState("");
  // Opening the dialog for a source preselects its first synthetic file.
  const setUploading = (source: IntakeSource | null) => {
    setUploadingSource(source);
    setSampleFile(INTAKE_SAMPLE_FILES.find((f) => f.source === source)?.key ?? "");
  };
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastUpload, setLastUpload] = useState<IntakeUploadView | null>(null);
  const [reviewing, setReviewing] = useState<IntakeDraftView | null>(null);
  const officer = me.role === "LOAN_OFFICER";
  const all = list.data ?? [];
  const rows = view === "pending" ? all.filter(isPending) : all;

  async function upload() {
    if (!uploading) return;
    setBusy(true);
    setUploadError(null);
    try {
      const done = await api<IntakeUploadView>("/intake/uploads", {
        method: "POST",
        body: { source: uploading, sampleFile },
      });
      setLastUpload(done);
      setUploading(null);
      const attention = done.flaggedCount
        ? ` · ${formatNumber(done.flaggedCount)} need${done.flaggedCount === 1 ? "s" : ""} attention`
        : "";
      toast(
        `${formatNumber(done.rowCount)} draft${done.rowCount === 1 ? "" : "s"} extracted for review${attention}`,
      );
      await list.reload();
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<IntakeDraftView>[] = [
    {
      key: "applicant",
      header: "Applicant",
      render: (d) => (
        <div>
          <p className="font-bold text-ink-900">{d.extracted.fullName ?? "Name not in the file"}</p>
          <p className="text-xs text-mist-500">
            {d.matchedApplicant ? "Customer on record" : "No customer match yet"}
          </p>
        </div>
      ),
    },
    { key: "product", header: "Product", render: () => productLabel("PL") },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: (d) =>
        d.extracted.amount
          ? d.extracted.tenorMonths === null
            ? `${formatPeso(d.extracted.amount)} · tenor not in the file`
            : `${formatPeso(d.extracted.amount)} / ${formatNumber(d.extracted.tenorMonths)} mo`
          : "Not in the file",
    },
    {
      key: "source",
      header: "Source",
      render: (d) => <span className="text-xs">{d.sourceDetail}</span>,
    },
    {
      key: "extraction",
      header: "Extraction",
      render: (d) =>
        d.flags.length === 0 ? (
          <Pill tone="ok">Complete</Pill>
        ) : (
          <span className="flex flex-wrap gap-1">
            {d.flags.map((f) => (
              <Pill key={f} tone="warn">
                {EXTRACTION_FLAG_LABEL[f]}
              </Pill>
            ))}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (d) =>
        d.case ? (
          <div>
            <Link
              href={`/cases/${d.case.id}`}
              className="font-mono text-xs underline-offset-2 hover:underline"
            >
              {d.case.reference}
            </Link>
            {d.applicantCaptured && (
              <p className="text-xs text-mist-500">Customer captured from the draft</p>
            )}
          </div>
        ) : (
          <Pill tone={STATUS_TONE[d.status]}>{INTAKE_DRAFT_STATUS_LABEL[d.status]}</Pill>
        ),
    },
    {
      key: "action",
      header: "Action",
      render: (d) =>
        d.actions.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Review draft: ${d.extracted.fullName ?? d.sourceDetail}`}
            onClick={() => setReviewing(d)}
          >
            Review
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Email and file intake"
        description="Upload an emailed document bundle or a partner's spreadsheet of applications. OCR extracts the data into drafts for a loan officer to review; nothing is submitted until you create the application draft and submit it from the case. Files and OCR are simulated in this release."
        actions={
          officer ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setUploading("PARTNER_SPREADSHEET")}>
                {UPLOAD.PARTNER_SPREADSHEET.button}
              </Button>
              <Button variant="secondary" onClick={() => setUploading("EMAIL_BUNDLE")}>
                {UPLOAD.EMAIL_BUNDLE.button}
              </Button>
            </div>
          ) : undefined
        }
      />
      {lastUpload && (
        <Callout tone="info" lead={`Extracted from ${lastUpload.fileName}:`} className="mb-4">
          {formatNumber(lastUpload.rowCount)} row{lastUpload.rowCount === 1 ? "" : "s"} extracted ·{" "}
          {formatNumber(lastUpload.flaggedCount)} need{lastUpload.flaggedCount === 1 ? "s" : ""}{" "}
          attention · <span className="font-mono text-xs">{lastUpload.reference}</span>
        </Callout>
      )}
      <div className="mb-4">
        <SegmentedFilter
          label="Which drafts"
          value={view}
          options={[
            {
              value: "pending" as const,
              label: "To review",
              count: list.data ? all.filter(isPending).length : undefined,
            },
            { value: "all" as const, label: "All", count: list.data ? all.length : undefined },
          ]}
          onChange={setView}
        />
      </div>
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
      {list.data && (
        <Card title="Drafts" aside={<SimulatedLabel what="OCR" />} flush>
          <Table
            caption="Intake drafts"
            columns={columns}
            rows={rows}
            rowKey={(d) => d.id}
            empty={
              view === "pending"
                ? "No drafts waiting for review. Upload a spreadsheet or email bundle to start."
                : "No drafts yet. Upload a spreadsheet or email bundle to start."
            }
          />
        </Card>
      )}

      {uploading && (
        <ConfirmDialog
          open
          title={UPLOAD[uploading].title}
          description={`Uploads are simulated: ${UPLOAD[uploading].file} — a synthetic file — is read by simulated OCR into drafts for you to review. No file is stored and no application is created or submitted.`}
          confirmLabel={UPLOAD[uploading].button}
          busy={busy}
          error={uploadError}
          onConfirm={upload}
          onCancel={() => {
            setUploading(null);
            setUploadError(null);
          }}
        >
          <Field label="Synthetic file">
            <Select value={sampleFile} onChange={(e) => setSampleFile(e.target.value)}>
              {INTAKE_SAMPLE_FILES.filter((f) => f.source === uploading).map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        </ConfirmDialog>
      )}
      {reviewing && (
        <ReviewDraftDialog
          draft={reviewing}
          onClose={() => setReviewing(null)}
          onConfirmed={(next) => {
            setReviewing(null);
            toast(
              `Application draft ${next.case?.reference ?? ""} created — record consent and submit it`,
            );
            refreshShell();
            if (next.case) router.push(`/cases/${next.case.id}`);
            else void list.reload();
          }}
          onDiscarded={() => {
            setReviewing(null);
            toast("Draft discarded");
            void list.reload();
          }}
          onStale={(message) => {
            setReviewing(null);
            toast(message, "warn");
            void list.reload();
          }}
        />
      )}
    </>
  );
}
