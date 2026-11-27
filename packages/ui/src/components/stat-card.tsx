import type { ReactNode } from "react";

/** The prototype's KPI card: a muted label, a large figure and an optional note. */
export function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="h-full rounded-card border border-line bg-white px-[18px] py-4 shadow-card">
      <p className="text-[13px] font-medium text-mist-500">{label}</p>
      <p className="mt-1.5 text-[28px] leading-tight font-extrabold text-ink-900 tabular-nums">
        {value}
      </p>
      {note && <p className="text-[12.5px] text-mist-500">{note}</p>}
    </div>
  );
}
