"use client";

import {
  type AuditEventView,
  type AuditLogPage,
  auditActionLabel,
  ROLE_LABEL,
  type Role,
} from "@loan/core";
import {
  Button,
  Callout,
  Card,
  type Column,
  Field,
  FormGrid,
  formatDateTime,
  Input,
  Select,
  Table,
} from "@loan/ui";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { LoadState } from "@/components/load-state";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";
import { type AuditFilters, auditQuery, NO_AUDIT_FILTERS } from "@/lib/audit";
import { useApi } from "@/lib/use-api";

function roleLabel(role: string): string {
  if (role === "SYSTEM") return "System";
  if (role === "NONE") return "No account";
  return ROLE_LABEL[role as Role] ?? role;
}

function columns(canOpenCases: boolean): Column<AuditEventView>[] {
  return [
    {
      key: "when",
      header: "When",
      render: (e) => (
        <span className="text-xs whitespace-nowrap">{formatDateTime(e.occurredAt)}</span>
      ),
    },
    {
      key: "who",
      header: "Who",
      render: (e) => (
        <div>
          <p className="font-bold text-ink-900">{e.actorName}</p>
          <p className="text-xs text-mist-500">{roleLabel(e.actorRole)}</p>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (e) => (
        <div>
          <p>{auditActionLabel(e.action)}</p>
          <p className="font-mono text-xs text-mist-500">{e.action}</p>
        </div>
      ),
    },
    {
      key: "case",
      header: "Case",
      render: (e) =>
        e.caseHidden ? (
          <span className="text-xs text-mist-500">A case (hidden)</span>
        ) : e.caseReference === null ? (
          <span className="text-xs text-mist-500">—</span>
        ) : canOpenCases && e.caseId ? (
          <Link
            href={`/cases/${e.caseId}`}
            className="font-mono text-xs underline-offset-2 hover:underline"
          >
            {e.caseReference}
          </Link>
        ) : (
          <span className="font-mono text-xs">{e.caseReference}</span>
        ),
    },
    {
      key: "summary",
      header: "What happened",
      render: (e) =>
        e.summary === null ? (
          <span className="text-xs text-mist-500">
            Case details are visible to Compliance only.
          </span>
        ) : (
          <span>{e.summary}</span>
        ),
    },
  ];
}

/**
 * The searchable audit log (PRD PLT-004): filters by person, action, business dates and case,
 * newest first, fifty at a time. The API validates the filters; its field errors show here.
 * Only Compliance may read cases, so only Compliance gets the case filter and case links.
 */
export function AuditLog({ canOpenCases }: { canOpenCases: boolean }) {
  const actions = useApi<string[]>("/audit/actions");
  const [draft, setDraft] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(NO_AUDIT_FILTERS);
  const [items, setItems] = useState<AuditEventView[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async (filters: AuditFilters, before: number | null) => {
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const page = await api<AuditLogPage>(auditQuery(filters, before));
      setItems((prev) => (before && prev ? [...prev, ...page.items] : page.items));
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(errorMessage(err));
      setFieldErrors(fieldErrorsOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied, null);
  }, [applied, load]);

  function search(ev: FormEvent) {
    ev.preventDefault();
    setApplied({ ...draft });
  }

  function clear() {
    setDraft(NO_AUDIT_FILTERS);
    setApplied(NO_AUDIT_FILTERS);
  }

  const set = (key: keyof AuditFilters) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <Card title="Search">
        <form onSubmit={search} noValidate>
          <FormGrid>
            <Field
              label="Person"
              hint="A name, or a staff id such as STF-PAOLO"
              error={fieldErrors.actor}
            >
              <Input value={draft.actor} onChange={(e) => set("actor")(e.target.value)} />
            </Field>
            <Field
              label="Action"
              hint={actions.loading ? "Loading the actions…" : undefined}
              error={
                fieldErrors.action ??
                (actions.error
                  ? `The list of actions could not be loaded: ${actions.error} Reload the page to filter by action.`
                  : undefined)
              }
            >
              <Select
                value={draft.action}
                disabled={actions.loading || actions.error !== null}
                onChange={(e) => set("action")(e.target.value)}
              >
                <option value="">Any action</option>
                {(actions.data ?? []).map((a) => (
                  <option key={a} value={a}>
                    {auditActionLabel(a)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" hint="Philippine business date" error={fieldErrors.from}>
              <Input type="date" value={draft.from} onChange={(e) => set("from")(e.target.value)} />
            </Field>
            <Field label="To" hint="Inclusive" error={fieldErrors.to}>
              <Input type="date" value={draft.to} onChange={(e) => set("to")(e.target.value)} />
            </Field>
            {canOpenCases && (
              <Field label="Case reference" hint="For example APP-1001" error={fieldErrors.case}>
                <Input
                  value={draft.caseReference}
                  onChange={(e) => set("caseReference")(e.target.value)}
                />
              </Field>
            )}
          </FormGrid>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={loading}>
              Search
            </Button>
            <Button type="button" variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          </div>
        </form>
      </Card>

      {/* First load: LoadState (with Try again); later failures keep the rows and say why. */}
      {items === null ? (
        <LoadState loading={loading} error={error} onRetry={() => void load(applied, null)} />
      ) : (
        error && (
          <Callout tone="bad" alert>
            {error}
          </Callout>
        )
      )}
      {items && (
        <Table
          caption="Audit log entries, newest first"
          columns={columns(canOpenCases)}
          rows={items}
          rowKey={(e) => String(e.seq)}
          empty="No entries match these filters."
        />
      )}
      {items && nextBefore !== null && (
        <div>
          <Button variant="secondary" busy={loading} onClick={() => void load(applied, nextBefore)}>
            Show older entries
          </Button>
        </div>
      )}
    </div>
  );
}
