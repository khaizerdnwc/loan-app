import type { Grade } from "@loan/core";
import { cn } from "../lib/cn";

/** Solid fills from the prototype (tokens in globals.css; B, C, D darkened for AA). */
export const GRADE_FILL: Record<Grade, string> = {
  A: "bg-grade-a",
  B: "bg-grade-b",
  C: "bg-grade-c",
  D: "bg-grade-d",
  E: "bg-grade-e",
};

/** A 30px solid tile with the risk grade A–E in white (the prototype's look). */
export function GradeTile({ grade }: { grade: Grade | null }) {
  return (
    <span
      role="img"
      aria-label={grade ? `Grade ${grade}` : "No grade"}
      className={cn(
        "inline-grid size-[30px] place-items-center rounded-tile text-sm font-extrabold",
        grade ? cn(GRADE_FILL[grade], "text-white") : "bg-mist-100 text-mist-500",
      )}
    >
      {grade ?? "—"}
    </span>
  );
}
