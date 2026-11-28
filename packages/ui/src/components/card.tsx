import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn";

export interface CardProps {
  title?: ReactNode;
  /** Small text or a pill on the right of the title. */
  aside?: ReactNode;
  /** No body padding: for a table or list that runs edge to edge (the prototype's `.bd.np`). */
  flush?: boolean;
  /**
   * Make the card a region landmark named by its title (needs `title`). Only for the few cards
   * worth jumping to on a screen: every landmark is a stop in a screen reader's landmark list.
   */
  region?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The prototype's card: a header bar (15px bold title, muted aside) over a soft divider, then
 * the body, in a `<section>`. Every title is an `<h2>`, so heading navigation reaches every
 * card. A titled Card is also a region landmark (the section labelled by its heading, so tests
 * and assistive tech find it by title) only when `region` is set: a landmark on every card
 * would bury the few worth jumping to, and a plain section is not a landmark.
 */
export function Card({
  title,
  aside,
  flush = false,
  region = false,
  className,
  children,
}: CardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={region && title ? headingId : undefined}
      className={cn("min-w-0 rounded-card border border-line bg-white shadow-card", className)}
    >
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft px-5 py-3.5">
          {title && (
            <h2 id={headingId} className="text-title font-bold text-ink-900">
              {title}
            </h2>
          )}
          {aside && <div className="text-xs text-mist-500">{aside}</div>}
        </header>
      )}
      <div className={flush ? undefined : "px-5 py-4"}>{children}</div>
    </section>
  );
}
