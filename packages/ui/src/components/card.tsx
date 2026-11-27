import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CardProps {
  title?: ReactNode;
  /** Small text or a pill on the right of the title. */
  aside?: ReactNode;
  /** No body padding: for a table or list that runs edge to edge (the prototype's `.bd.np`). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The prototype's card: a header bar (15px bold title, muted aside) over a soft divider, then
 * the body. A `<section>` named by its heading, so tests and assistive tech find it by title.
 */
export function Card({ title, aside, flush = false, className, children }: CardProps) {
  return (
    <section
      className={cn("min-w-0 rounded-card border border-line bg-white shadow-card", className)}
    >
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft px-5 py-3.5">
          {title && <h2 className="text-title font-bold text-ink-900">{title}</h2>}
          {aside && <div className="text-xs text-mist-500">{aside}</div>}
        </header>
      )}
      <div className={flush ? undefined : "px-5 py-4"}>{children}</div>
    </section>
  );
}
