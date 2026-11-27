/** Marks a value that came from a simulated external service (PRD IH-008). */
export function SimulatedLabel({ what }: { what?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-info-700/40 bg-info-050 px-2 py-0.5 text-[11px] font-semibold text-info-700">
      Simulated{what ? ` · ${what}` : ""}
    </span>
  );
}
