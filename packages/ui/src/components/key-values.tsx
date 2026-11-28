import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface KeyValue {
  label: string;
  value: ReactNode;
  /** An identifier (reference, account, masked ID): monospace. Amounts and words never are. */
  mono?: boolean;
}

/**
 * The prototype's `dl.kv`: label-over-value fields flowing in columns of at least 150px — a
 * small uppercase label, then the value in the body font. The one way a screen shows a record's
 * facts (applicant, approved terms, loan account). Each pair is wrapped in a div, so a label's
 * parent holds its value.
 */
export function KeyValues({ items, className }: { items: KeyValue[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-4",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-2xs font-bold tracking-wider text-mist-500 uppercase">
            {item.label}
          </dt>
          <dd
            data-mono={item.mono || undefined}
            className={cn(
              "mt-1 text-base font-medium break-words text-ink-900",
              item.mono && "font-mono text-sm",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
