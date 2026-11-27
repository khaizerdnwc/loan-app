import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "danger" | "ghost";

/**
 * The prototype's final theme draws both its primary and its accent page actions in dark
 * ink ("New assisted application", "Submit for decision"); gold is kept for counts, focus
 * and warnings. `accent` stays a separate name so the two can diverge again in one place.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink-800 text-white hover:bg-ink-900",
  accent: "bg-ink-800 text-white hover:bg-ink-900",
  secondary: "border border-line bg-white text-ink-800 hover:bg-mist-050",
  danger: "bg-bad-700 text-white hover:bg-bad-500",
  ghost: "text-ink-700 hover:bg-mist-100",
};

/** A button's classes, for a link that should look like one (never a <button> inside <a>). */
export function buttonClass(variant: ButtonVariant = "secondary", className?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-btn px-4 py-2 text-sm font-semibold",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-700",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT[variant],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
}

/** A button. `busy` disables it and says so, so a double click cannot send twice. */
export function Button({
  variant = "secondary",
  busy = false,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass(variant, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? "Working…" : children}
    </button>
  );
}
