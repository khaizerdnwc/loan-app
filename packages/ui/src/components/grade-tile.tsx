import type { Grade } from "@loan/core";
import { cn } from "../lib/cn";

const GRADE: Record<Grade, string> = {
  A: "bg-ok-100 text-ok-700",
  B: "bg-ok-050 text-ok-700",
  C: "bg-gold-100 text-gold-700",
  D: "bg-bad-050 text-bad-700",
  E: "bg-bad-100 text-bad-700",
};

/** A 30px tile with the risk grade A–E (the prototype's look). */
export function GradeTile({ grade }: { grade: Grade | null }) {
  return (
    <span
      role="img"
      aria-label={grade ? `Grade ${grade}` : "No grade"}
      className={cn(
        "inline-flex size-[30px] items-center justify-center rounded-md font-mono text-sm font-bold",
        grade ? GRADE[grade] : "bg-mist-100 text-mist-500",
      )}
    >
      {grade ?? "—"}
    </span>
  );
}
