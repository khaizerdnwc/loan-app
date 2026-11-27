/** The audit log's search filters, as the form holds them (empty string = not set). */
export interface AuditFilters {
  actor: string;
  action: string;
  from: string;
  to: string;
  caseReference: string;
}

export const NO_AUDIT_FILTERS: AuditFilters = {
  actor: "",
  action: "",
  from: "",
  to: "",
  caseReference: "",
};

/** The `/audit/events` query for these filters and page; the API validates every value. */
export function auditQuery(f: AuditFilters, before?: number | null, limit = 50): string {
  const params = new URLSearchParams();
  if (f.actor.trim()) params.set("actor", f.actor.trim());
  if (f.action) params.set("action", f.action);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.caseReference.trim()) params.set("case", f.caseReference.trim());
  if (before) params.set("before", String(before));
  params.set("limit", String(limit));
  return `/audit/events?${params.toString()}`;
}
