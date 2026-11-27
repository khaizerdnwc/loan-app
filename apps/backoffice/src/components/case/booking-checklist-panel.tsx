"use client";

import type { BookingCheckView } from "@loan/core";
import { Card, formatAmountsInText, Pill } from "@loan/ui";

/** The same marks as the decision panel's policy rules. */
const MARK = {
  pass: { mark: "✓", label: "passes", tone: "bg-ok-050 text-ok-700" },
  fail: { mark: "✕", label: "fails", tone: "bg-bad-050 text-bad-700" },
} as const;

/**
 * The pre-booking checklist (PRD BKG-001), as the API computed it. The API refuses to submit
 * or approve the booking until every item passes; this card only shows its verdict.
 */
export function BookingChecklistPanel({ items }: { items: BookingCheckView[] }) {
  const passed = items.filter((i) => i.passed).length;
  const complete = passed === items.length;
  return (
    <Card
      title="Pre-booking checklist"
      aside={
        <Pill tone={complete ? "ok" : "bad"}>
          {complete ? "Every item passes" : `${passed} of ${items.length} pass`}
        </Pill>
      }
    >
      <ul className="flex flex-col divide-y divide-line" aria-label="Pre-booking checklist">
        {items.map((item) => {
          const m = item.passed ? MARK.pass : MARK.fail;
          return (
            <li key={item.check} className="flex items-start gap-2 py-2 text-sm">
              <span
                aria-hidden="true"
                className={`grid size-5 shrink-0 place-items-center rounded-full text-2xs font-extrabold ${m.tone}`}
              >
                {m.mark}
              </span>
              <span>
                <span className="text-ink-900">{item.label}</span>
                <span className="sr-only"> — {m.label}</span>
                <span className={`block text-xs ${item.passed ? "text-mist-500" : "text-bad-700"}`}>
                  {formatAmountsInText(item.detail)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-mist-500">
        Booking opens the loan account in core banking with the approved terms; a second user must
        approve it before it runs.
      </p>
    </Card>
  );
}
