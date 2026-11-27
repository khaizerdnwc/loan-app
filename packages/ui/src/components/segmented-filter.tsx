import { cn } from "../lib/cn";

export interface SegmentedFilterProps<T extends string> {
  /** What the buttons filter, read by screen readers as the group's name. */
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}

/**
 * The prototype's segmented pill control, used as a filter: a fieldset (a group named by its
 * legend) of toggle buttons where the chosen one is `aria-pressed`. Not a tablist: it narrows the list below,
 * it does not switch between panels, so each button is reached with Tab like any button.
 */
export function SegmentedFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedFilterProps<T>) {
  return (
    <fieldset className="inline-flex max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-btn border border-line bg-mist-100 p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-tab px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors",
            o.value === value
              ? "bg-white font-bold text-ink-900 shadow-card"
              : "font-medium text-mist-600 hover:text-ink-800",
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="ml-2 rounded-full bg-mist-200 px-1.5 text-xs font-bold text-ink-800 tabular-nums">
              {o.count}
            </span>
          )}
        </button>
      ))}
    </fieldset>
  );
}
