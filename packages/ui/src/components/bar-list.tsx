import { cn } from "../lib/cn";

export type BarTone = "ink" | "gold" | "ok" | "bad";

const FILL: Record<BarTone, string> = {
  ink: "bg-ink-700",
  gold: "bg-gold-500",
  ok: "bg-ok-700",
  bad: "bg-bad-500",
};

export interface Bar {
  label: string;
  value: number;
  /** What is printed at the end of the bar ("42%", "1,204"); the value when absent. */
  display?: string;
  tone?: BarTone;
}

/**
 * The prototype's `.hbar` rows: a label, a bar scaled to the largest value (or `max`), and
 * the figure. A list, so a screen reader reads "label: figure" for each bar; the bars
 * themselves are decorative.
 */
export function BarList({
  bars,
  max,
  label,
}: {
  bars: Bar[];
  max?: number;
  /** What the list shows, for assistive tech. */
  label: string;
}) {
  const top = max ?? Math.max(0, ...bars.map((b) => b.value));
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {bars.map((b) => {
        // A value above zero always shows a sliver; zero draws nothing.
        const width = top > 0 && b.value > 0 ? Math.max(2, Math.round((b.value / top) * 100)) : 0;
        return (
          <li
            key={b.label}
            className="grid grid-cols-[minmax(100px,200px)_minmax(48px,1fr)_auto] items-center gap-2.5 py-1 text-sm"
          >
            {/* Labels wrap: a referral trigger or reason is a sentence, never cut off. */}
            <span className="break-words">{b.label}</span>
            <span aria-hidden="true" className="h-4 overflow-hidden rounded-tab bg-mist-100">
              <span
                className={cn("block h-full rounded-tab", FILL[b.tone ?? "ink"])}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="text-right font-semibold whitespace-nowrap text-ink-900 tabular-nums">
              <span className="sr-only">: </span>
              {b.display ?? String(b.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
