import { cn } from "../lib/cn";

/** Up to two initials: the first letter of the first two words ("Joel Reyes" → "JR"). */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/**
 * The prototype's initials avatar: 28px, radius 8, lavender with ink text, 800 weight at
 * 11px. Decorative next to the person's name, so hidden from screen readers.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid size-7 shrink-0 place-items-center rounded-tile bg-lav text-[11px] font-extrabold text-ink-800",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
