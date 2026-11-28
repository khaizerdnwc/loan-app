"use client";

import type { DecisionOutcome, HarnessRow, HarnessRunView, ModelRegistryView } from "@loan/core";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  formatDate,
  formatNumber,
  Input,
  OUTCOME_LABEL,
  Select,
  SimulatedLabel,
  Table,
} from "@loan/ui";
import { type ReactNode, useState } from "react";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";

const outcome = (o: DecisionOutcome) => OUTCOME_LABEL[o];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-2xs font-bold tracking-wider text-mist-500 uppercase">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * The rule-set test harness (PRD DEC-004, F8 step 1): replays the period's stored decisions
 * under a candidate rule set and a baseline and compares them. It compares only: it never
 * publishes a rule set or changes a case. Each run is recorded in the audit log.
 */
export function HarnessCard({ registry }: { registry: ModelRegistryView }) {
  const versions = registry.ruleSets.map((r) => r.version);
  const live = registry.ruleSets.find((r) => r.current)?.version ?? versions[versions.length - 1];
  const [candidate, setCandidate] = useState(versions.find((v) => v !== live) ?? versions[0] ?? "");
  const [baseline, setBaseline] = useState(live ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [run, setRun] = useState<HarnessRunView | null>(null);

  async function compare() {
    setError(null);
    setFields({});
    if (candidate === baseline) {
      setFields({ candidate: "Choose a rule set other than the one it is compared with." });
      return;
    }
    setBusy(true);
    try {
      setRun(
        await api<HarnessRunView>("/models/harness", {
          method: "POST",
          body: { candidate, baseline, ...(from ? { from } : {}), ...(to ? { to } : {}) },
        }),
      );
    } catch (e) {
      // Every field error is shown at its field; the API's detail always shows in the callout.
      setError(errorMessage(e));
      setFields(fieldErrorsOf(e));
      // A refused run leaves no earlier result on screen to be mistaken for this one.
      setRun(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Rule-set test harness" aside={<SimulatedLabel what="data" />}>
      <Callout tone="info" lead="Compares, never publishes.">
        Replays stored decisions under two rule sets and shows what would change. Running it does
        not publish a rule set, change a case or call a provider; publishing a new version is a
        separate, maker-checker step not in this release. Each run is recorded in the audit log.
      </Callout>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <Field label="Candidate rule set" error={fields.candidate}>
            <Select value={candidate} onChange={(e) => setCandidate(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {v === live ? " (live)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-40">
          <Field label="Compared with" error={fields.baseline}>
            <Select value={baseline} onChange={(e) => setBaseline(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {v === live ? " (live)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-40">
          <Field label="From (optional)" error={fields.from}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="min-w-40">
          <Field label="To (optional)" error={fields.to}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" onClick={compare} busy={busy}>
          {busy ? "Comparing…" : "Compare"}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-mist-500">
        Without dates: the last 30 days. Each case's latest decision is replayed, newest first, up
        to a cap stated with the result.
      </p>
      {error && (
        <Callout tone="bad" alert className="mt-4">
          {error}
        </Callout>
      )}
      {run && <HarnessResult run={run} />}
    </Card>
  );
}

function HarnessResult({ run }: { run: HarnessRunView }) {
  const capped = run.decisionsInPeriod > run.cap;
  const moved = run.movement.filter((m) => m.from !== m.to && m.count > 0);
  if (run.compared === 0 && run.notComparable.length === 0) {
    return (
      <EmptyState
        title="No decisions in this period"
        hint={`${run.candidate} against ${run.baseline}, ${formatDate(run.period.from)} to ${formatDate(run.period.to)}.`}
      />
    );
  }
  return (
    <section className="mt-5 flex flex-col gap-5" aria-label="Harness result">
      <p className="text-sm">
        {run.candidate} against {run.baseline}, {formatDate(run.period.from)} to{" "}
        {formatDate(run.period.to)}: {formatNumber(run.compared)} decisions compared,{" "}
        {formatNumber(run.changed.length)} changed, {formatNumber(run.notComparable.length)} not
        comparable.{" "}
        {capped
          ? `${formatNumber(run.decisionsInPeriod)} cases had a decision in the period; only the newest ${formatNumber(run.cap)} (the cap) were replayed.`
          : `At most ${formatNumber(run.cap)} decisions are replayed per run; this period had ${formatNumber(run.decisionsInPeriod)}.`}
      </p>
      <Section title="Outcomes under each rule set (the rules' own outcome, before any automation mode)">
        <Table
          caption="Outcomes under each rule set"
          columns={[
            { key: "outcome", header: "Outcome", render: (r) => outcome(r.outcome) },
            { key: "baseline", header: run.baseline, numeric: true, render: (r) => r.baseline },
            { key: "candidate", header: run.candidate, numeric: true, render: (r) => r.candidate },
          ]}
          rows={run.outcomes}
          rowKey={(r) => r.outcome}
          empty="No decisions."
        />
      </Section>
      <Section title="Outcomes that moved">
        <Table
          caption="Decisions whose outcome moved"
          columns={[
            { key: "from", header: `Under ${run.baseline}`, render: (m) => outcome(m.from) },
            { key: "to", header: `Under ${run.candidate}`, render: (m) => outcome(m.to) },
            { key: "count", header: "Decisions", numeric: true, render: (m) => m.count },
          ]}
          rows={moved}
          rowKey={(m) => `${m.from}-${m.to}`}
          empty="No outcome moved."
        />
      </Section>
      <Section title="Changed decisions (outcome or reason codes)">
        <RowsTable caption="Changed decisions" rows={run.changed} empty="Nothing changed." />
      </Section>
      {run.withDefaults.length > 0 && (
        <Section title="Replayed with a default for an input their record lacks">
          <RowsTable caption="Decisions replayed with defaults" rows={run.withDefaults} empty="" />
        </Section>
      )}
      {run.notComparable.length > 0 && (
        <Section title="Not comparable (never guessed)">
          <Table
            caption="Decisions that could not be replayed"
            columns={[
              {
                key: "ref",
                header: "Case",
                render: (r) => <span className="font-mono">{r.caseReference}</span>,
              },
              { key: "reason", header: "Why", render: (r) => r.reason },
            ]}
            rows={run.notComparable}
            rowKey={(r) => r.caseReference}
            empty=""
          />
        </Section>
      )}
    </section>
  );
}

/** "Added R29 · Policy exception: …": the code in monospace, its wording from the API. */
function ReasonLine({ verb, code, staff }: { verb: string; code: string; staff: string }) {
  return (
    <li>
      {verb} <span className="font-mono">{code}</span> · {staff}
    </li>
  );
}

function RowsTable({
  caption,
  rows,
  empty,
}: {
  caption: string;
  rows: HarnessRow[];
  empty: string;
}) {
  return (
    <Table
      caption={caption}
      columns={[
        {
          key: "ref",
          header: "Case",
          render: (r) => <span className="font-mono">{r.caseReference}</span>,
        },
        {
          key: "outcome",
          header: "Outcome",
          render: (r) =>
            r.baselineOutcome === r.candidateOutcome
              ? `${outcome(r.baselineOutcome)} (unchanged)`
              : `${outcome(r.baselineOutcome)} → ${outcome(r.candidateOutcome)}`,
        },
        {
          key: "reasons",
          header: "Reason codes",
          render: (r) =>
            r.reasonsAdded.length === 0 && r.reasonsRemoved.length === 0 ? (
              "same"
            ) : (
              <ul className="flex flex-col gap-1">
                {r.reasonsAdded.map((c) => (
                  <ReasonLine key={`+${c.code}`} verb="Added" code={c.code} staff={c.staff} />
                ))}
                {r.reasonsRemoved.map((c) => (
                  <ReasonLine key={`-${c.code}`} verb="Removed" code={c.code} staff={c.staff} />
                ))}
              </ul>
            ),
        },
        {
          key: "defaults",
          header: "Defaults used",
          render: (r) => (r.defaults.length > 0 ? r.defaults.join("; ") : "none"),
        },
      ]}
      rows={rows}
      rowKey={(r) => r.caseReference}
      empty={empty}
    />
  );
}
