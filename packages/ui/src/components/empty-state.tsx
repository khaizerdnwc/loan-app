import type { ReactNode } from "react";

/** The prototype's `.empty`: a bold line saying what is (not) here, then an optional hint. */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-mist-500">
      <p className="text-base font-bold text-ink-900">{title}</p>
      {hint && <p className="mt-1">{hint}</p>}
    </div>
  );
}
