import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CardProps {
  title?: ReactNode;
  /** Small text or a pill on the right of the title. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ title, aside, className, children }: CardProps) {
  return (
    <section className={cn("rounded-card border border-line bg-white p-5 shadow-card", className)}>
      {(title || aside) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-bold text-ink-900">{title}</h2>}
          {aside && <div className="text-xs text-mist-500">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
