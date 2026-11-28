"use client";

import type { BusinessCalendarView, HolidayChangeView, HolidayView } from "@loan/core";
import {
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Field,
  FormStack,
  formatDate,
  formatDateTime,
  Input,
  Pill,
  Table,
  Textarea,
  useToast,
} from "@loan/ui";
import { type ReactNode, useState } from "react";
import { api, errorMessage, fieldErrorsOf } from "@/lib/api";

type Dialog =
  | { kind: "add" }
  | { kind: "remove"; holiday: HolidayView }
  | { kind: "approve"; change: HolidayChangeView }
  | { kind: "reject"; change: HolidayChangeView }
  | { kind: "withdraw"; change: HolidayChangeView }
  | null;
type Kind = Exclude<Dialog, null>["kind"];

/** The inputs each dialog shows; a field error for any other field joins the dialog's error. */
const SHOWN: Record<Kind, readonly string[]> = {
  add: ["date", "name", "reason"],
  remove: ["reason"],
  approve: ["note"],
  reject: ["note"],
  withdraw: ["note"],
};

const WEEKDAY = new Intl.DateTimeFormat("en-PH", { weekday: "long", timeZone: "UTC" });
/** "Monday, 4 Jan 2027" for a YYYY-MM-DD date. */
const dayLabel = (date: string) =>
  `${WEEKDAY.format(new Date(`${date}T00:00:00.000Z`))}, ${formatDate(date)}`;
/** The day after a YYYY-MM-DD date. */
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The business calendar (PRD PLT-005): the holidays the business clock skips, and the changes
 * waiting for a second administrator. It offers only days after today and only the decisions
 * the API lists in `allowedActions`; maker-checker, future days only and one pending change per
 * date are decided by the API, and a refusal is shown in the API's own words.
 */
export function BusinessCalendarPanel({
  view,
  onChanged,
}: {
  view: BusinessCalendarView;
  onChanged: (next: BusinessCalendarView) => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const pendingDates = new Set(view.pending.map((c) => c.date));
  const ahead = view.holidays.filter((h) => h.date > view.today);
  const passed = view.holidays.length - ahead.length;

  function open(next: Dialog) {
    setDialog(next);
    setDate("");
    setName("");
    setText("");
    setError(null);
    setFields({});
  }

  async function confirm() {
    if (!dialog) return;
    const missing: Record<string, string> = {};
    if (dialog.kind === "add" && !date) missing.date = "Choose a date.";
    if (dialog.kind === "add" && !name.trim()) missing.name = "Enter a name.";
    if ((dialog.kind === "add" || dialog.kind === "remove") && !text.trim())
      missing.reason = "Enter a reason.";
    if (Object.keys(missing).length > 0) {
      setFields(missing);
      return;
    }
    const note = text.trim() ? { note: text } : {};
    const decide = (id: string, verb: "approve" | "reject") =>
      api<BusinessCalendarView>(`/calendar/changes/${id}/${verb}`, { method: "POST", body: note });
    const draft = (body: object) =>
      api<BusinessCalendarView>("/calendar/changes", { method: "POST", body });
    let call: () => Promise<BusinessCalendarView>;
    let done: string;
    switch (dialog.kind) {
      case "add":
        call = () => draft({ action: "ADD", date, name, reason: text });
        done = "Holiday drafted — waiting for a second administrator";
        break;
      case "remove":
        call = () => draft({ action: "REMOVE", date: dialog.holiday.date, reason: text });
        done = "Removal drafted — waiting for a second administrator";
        break;
      case "approve":
        call = () => decide(dialog.change.id, "approve");
        done =
          dialog.change.action === "ADD"
            ? `${formatDate(dialog.change.date)} is now a holiday`
            : `${formatDate(dialog.change.date)} is a business day again`;
        break;
      case "reject":
        call = () => decide(dialog.change.id, "reject");
        done = "Request rejected — the calendar is unchanged";
        break;
      case "withdraw":
        // Withdrawing your own request is the same call; the API records it as withdrawn.
        call = () => decide(dialog.change.id, "reject");
        done = "Request withdrawn — the calendar is unchanged";
        break;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const next = await call();
      toast(done, "ok");
      setDialog(null);
      onChanged(next);
    } catch (e) {
      const byField = fieldErrorsOf(e);
      // The API's words stay in the dialog's error. A field error sits under its input when
      // this dialog has one; otherwise (a date refused on a removal, say) it joins the error.
      const unshown = Object.entries(byField)
        .filter(([field]) => !SHOWN[dialog.kind].includes(field))
        .map(([, message]) => message);
      setError([errorMessage(e), ...unshown].join(" "));
      setFields(byField);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {view.pending.length > 0 && (
        <Card title="Waiting for approval" region>
          <ul className="flex flex-col gap-3">
            {view.pending.map((change) => {
              const own = change.allowedActions.approveBlockedReason !== null;
              return (
                <li key={change.id}>
                  <Callout
                    tone="warn"
                    lead={change.action === "ADD" ? "Add a holiday:" : "Remove a holiday:"}
                  >
                    <span>
                      {dayLabel(change.date)} — {change.name}. Drafted by {change.requestedByName} (
                      {formatDateTime(change.requestedAt)}).
                    </span>
                    <p className="mt-1">Reason: {change.reason}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {change.allowedActions.approve && (
                        <Button variant="primary" onClick={() => open({ kind: "approve", change })}>
                          Approve change
                        </Button>
                      )}
                      {change.allowedActions.reject && !own && (
                        <Button
                          variant="secondary"
                          onClick={() => open({ kind: "reject", change })}
                        >
                          Reject change
                        </Button>
                      )}
                      {change.allowedActions.reject && own && (
                        <Button
                          variant="secondary"
                          onClick={() => open({ kind: "withdraw", change })}
                        >
                          Withdraw request
                        </Button>
                      )}
                    </div>
                    {change.allowedActions.approveBlockedReason && (
                      <p className="mt-1 text-xs text-mist-500">
                        {change.allowedActions.approveBlockedReason}
                      </p>
                    )}
                  </Callout>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card
        title="Holidays ahead"
        region
        aside={
          <Button variant="primary" onClick={() => open({ kind: "add" })}>
            Request a holiday…
          </Button>
        }
        flush
      >
        <Table<HolidayView>
          caption="Holidays after today"
          columns={[
            { key: "date", header: "Date", render: (h) => dayLabel(h.date) },
            { key: "name", header: "Holiday", render: (h) => h.name },
            {
              key: "action",
              header: "Change",
              render: (h) =>
                pendingDates.has(h.date) ? (
                  <Pill tone="warn">Change waiting</Pill>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => open({ kind: "remove", holiday: h })}
                    aria-label={`Request removal of ${h.name}, ${formatDate(h.date)}`}
                  >
                    Request removal…
                  </Button>
                ),
            },
          ]}
          rows={ahead}
          rowKey={(h) => h.date}
          empty="No holidays after today. Weekends are always outside business time."
        />
        {/* Under the table, not in its footer, so it shows when the list is empty too. */}
        <p className="px-5 py-3 text-xs text-mist-500">
          Business time is Monday to Friday, 09:00–17:00 Manila, less these days.
          {passed > 0 &&
            ` ${passed} earlier ${passed === 1 ? "day stays" : "days stay"} as measured and cannot change.`}{" "}
          A change takes effect only when a second administrator approves it.
        </p>
      </Card>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog ? titleOf(dialog) : ""}
        description={dialog ? describeDialog(dialog) : ""}
        confirmLabel={dialog ? CONFIRM[dialog.kind] : ""}
        variant={dialog?.kind === "remove" ? "danger" : "primary"}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      >
        {dialog && (
          <FormStack>
            {dialog.kind === "add" && (
              <>
                <Field label="Date" hint="A weekday after today." error={fields.date}>
                  <Input
                    type="date"
                    value={date}
                    min={nextDay(view.today)}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <Field label="Name" error={fields.name}>
                  <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                </Field>
              </>
            )}
            <Field
              label={
                dialog.kind === "add" || dialog.kind === "remove" ? "Reason" : "Note (optional)"
              }
              error={fields.reason ?? fields.note}
            >
              <Textarea value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            </Field>
          </FormStack>
        )}
      </ConfirmDialog>
    </div>
  );
}

const CONFIRM: Record<Kind, string> = {
  add: "Draft change",
  remove: "Draft change",
  approve: "Approve change",
  reject: "Reject change",
  withdraw: "Withdraw request",
};

function titleOf(d: Exclude<Dialog, null>): string {
  switch (d.kind) {
    case "add":
      return "Ask to add a holiday?";
    case "remove":
      return `Ask to remove ${d.holiday.name} (${formatDate(d.holiday.date)})?`;
    case "approve":
      return d.change.action === "ADD"
        ? `Make ${formatDate(d.change.date)} a holiday now?`
        : `Make ${formatDate(d.change.date)} a business day now?`;
    case "reject":
      return "Reject this change?";
    case "withdraw":
      return "Withdraw your request?";
  }
}

function describeDialog(d: Exclude<Dialog, null>): ReactNode {
  switch (d.kind) {
    case "add":
      return "The business clock will skip that day: SLA due times that fall on or after it move later. Nothing changes until a second administrator approves it.";
    case "remove":
      return "The business clock will count that day again: SLA due times after it may come sooner. Nothing changes until a second administrator approves it.";
    case "approve":
      return d.change.action === "ADD"
        ? "Open cases' SLA due times move past this day at once, for everyone."
        : "Open cases' SLA due times count this day again at once, for everyone.";
    case "reject":
    case "withdraw":
      return "The calendar stays as it is. The request is kept in the audit log.";
  }
}
