import { cn } from "../lib/cn";

export interface TabsProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}

/** Segmented pill tabs (the prototype's queue tabs). */
export function Tabs<T extends string>({ label, value, options, onChange }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex gap-1 rounded-full bg-mist-100 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
            o.value === value
              ? "bg-white text-ink-900 shadow-card"
              : "text-mist-600 hover:text-ink-800",
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="ml-2 font-mono text-xs text-mist-500">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
