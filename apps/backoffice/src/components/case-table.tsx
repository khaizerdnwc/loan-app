"use client";

import { type CaseSummary, CHANNEL_LABEL, productLabel, type SlaView } from "@loan/core";
import {
  Avatar,
  Button,
  type Column,
  formatDateTime,
  formatPeso,
  GradeTile,
  OutcomePill,
  Pill,
  ROW_LINK,
  StagePill,
  Table,
} from "@loan/ui";
import Link from "next/link";
import { SlaPill } from "@/components/sla";

/** Whether a row offers Pick: a referral in the team queue (the API decides on the click). */
export function pickable(c: CaseSummary): boolean {
  return (c.status === "REVIEW" || c.status === "INFO_REQUESTED") && c.ownerId === null;
}

const COLUMNS: Column<CaseSummary>[] = [
  {
    key: "applicant",
    header: "Applicant",
    render: (c) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={c.applicantName} />
        <div>
          {/* The row's one link: Tab reaches it, Enter opens it, and a click anywhere on the
              row follows it (Table clickableRows). */}
          <Link
            {...ROW_LINK}
            href={`/cases/${c.id}`}
            className="font-bold text-ink-900 underline-offset-2 hover:underline"
          >
            {c.applicantName}
          </Link>
          <p className="font-mono text-xs text-mist-500">{c.reference}</p>
        </div>
      </div>
    ),
  },
  {
    key: "product",
    header: "Product",
    render: (c) => <span>{productLabel(c.productCode)}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    numeric: true,
    render: (c) => (
      <div>
        <span className="font-bold text-ink-900">{formatPeso(c.requestedAmount)}</span>
        <p className="text-xs text-mist-500">{c.requestedTenorMonths} months</p>
      </div>
    ),
  },
  {
    key: "stage",
    header: "Stage",
    render: (c) => (
      <div className="flex flex-wrap items-center gap-1.5">
        <StagePill status={c.status} />
        {c.priority === "HIGH" && <Pill tone="bad">High priority</Pill>}
      </div>
    ),
  },
  {
    key: "reason",
    header: "Reason",
    // The prototype's Reason column: why the decision went the way it did, in one short line.
    render: (c) =>
      c.reason ? (
        <span className="text-xs">
          {c.reason}
          {c.reasonCount > 1 && (
            <span className="ml-1.5 whitespace-nowrap text-mist-500">
              +{c.reasonCount - 1} more
            </span>
          )}
        </span>
      ) : (
        <span className="text-mist-500">
          <span aria-hidden="true">—</span>
          <span className="sr-only">None</span>
        </span>
      ),
  },
  {
    key: "outcome",
    header: "Decision",
    render: (c) => (
      <div className="flex items-center gap-2">
        <OutcomePill outcome={c.outcome} />
        {c.escalated && <Pill tone="bad">Escalated</Pill>}
      </div>
    ),
  },
  { key: "grade", header: "Grade", render: (c) => <GradeTile grade={c.grade} /> },
  {
    key: "updated",
    header: "Updated",
    render: (c) => <span className="text-xs whitespace-nowrap">{formatDateTime(c.updatedAt)}</span>,
  },
];

/** Who owns the case (WF-002) and where it came in; Pick for a referral nobody owns yet. */
function ownerColumn(
  onPick?: (c: CaseSummary) => void,
  busyId?: string | null,
): Column<CaseSummary> {
  return {
    key: "owner",
    header: "Owner",
    render: (c) => (
      <div>
        {c.ownerName ? (
          <span className="text-ink-900">{c.ownerName}</span>
        ) : (
          <span className="text-mist-500">Unassigned</span>
        )}
        <p className="text-xs text-mist-500">{CHANNEL_LABEL[c.channel]}</p>
        {onPick && pickable(c) && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-1"
            aria-label={`Pick ${c.applicantName}'s case`}
            busy={busyId === c.id}
            disabled={Boolean(busyId)}
            onClick={() => onPick(c)}
          >
            Pick
          </Button>
        )}
      </div>
    ),
  };
}

/** The SLA column (PRD WF-003), shown when the page has the clocks for its cases. */
function slaColumn(sla: ReadonlyMap<string, SlaView>): Column<CaseSummary> {
  return {
    key: "sla",
    header: "SLA (business hours)",
    render: (c) => {
      const clock = sla.get(c.id);
      return clock ? (
        <SlaPill sla={clock} />
      ) : (
        <span className="text-xs text-mist-500">No SLA</span>
      );
    },
  };
}

export function CaseTable({
  cases,
  empty,
  onPick,
  busyId = null,
  sla,
}: {
  cases: CaseSummary[];
  empty: string;
  /** The loan officer's queue: offer Pick on unassigned referrals. */
  onPick?: (c: CaseSummary) => void;
  /** The case whose Pick is in flight: its button is busy and every Pick waits for it. */
  busyId?: string | null;
  /** Each case's stage clock; when given, the table shows an SLA column. */
  sla?: ReadonlyMap<string, SlaView>;
}) {
  // The owner goes after the amount, found by its key (not its position).
  const at = COLUMNS.findIndex((col) => col.key === "amount") + 1;
  const columns = [...COLUMNS.slice(0, at), ownerColumn(onPick, busyId), ...COLUMNS.slice(at)];
  return (
    <Table
      caption="Loan applications"
      columns={sla ? [...columns, slaColumn(sla)] : columns}
      rows={cases}
      rowKey={(c) => c.id}
      empty={empty}
      clickableRows
    />
  );
}
