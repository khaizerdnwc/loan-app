import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "danger" | "ghost";
export type ButtonSize = "md" | "sm";

/**
 * One button hierarchy, copied from the prototype's final theme (.btn, .btn.pri, .btn.dan):
 *
 * - `primary`   dark ink, white text: the one action that moves the work forward. At most one
 *               per card or dialog.
 * - `secondary` white with the strong border: every other action (cancel, view, save draft).
 * - `danger`    solid red: an action that ends or refuses something (decline, failure modes).
 * - `ghost`     no border: low-emphasis actions in a card header or a toolbar.
 *
 * `accent` is kept as a name for the same dark-ink look the prototype gives its accent buttons
 * ("New assisted application", "Submit application"); new code uses `primary`.
 * Disabled looks disabled (sunken fill, muted text), not a faded copy of the variant.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-ink-800 bg-ink-800 text-white hover:border-ink-900 hover:bg-ink-900",
  accent: "border-ink-800 bg-ink-800 text-white hover:border-ink-900 hover:bg-ink-900",
  secondary: "border-line-strong bg-white text-ink-800 hover:bg-mist-050",
  danger: "border-bad-700 bg-bad-700 text-white hover:border-bad-800 hover:bg-bad-800",
  ghost: "border-transparent bg-transparent text-ink-700 hover:bg-mist-100",
};

const SIZE: Record<ButtonSize, string> = {
  /* min-h-11 is 38.5px at the 14px root (spacing is 0.875× Tailwind's 16px-root values), the
     same rendered height as Input and Select, so a button beside a field lines up. */
  md: "min-h-11 rounded-btn px-4 py-2 text-sm",
  /* The prototype's .btn.sm: row actions and card headers. */
  sm: "min-h-8 rounded-nav px-3 py-1 text-xs",
};

/** A button's classes, for a link that should look like one (never a <button> inside <a>). */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  className?: string,
  size: ButtonSize = "md",
): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 border text-center font-semibold",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-700",
    "disabled:cursor-not-allowed disabled:border-mist-200 disabled:bg-mist-100 disabled:text-mist-500",
    SIZE[size],
    VARIANT[variant],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
}

/** A button. `busy` disables it and says so, so a double click cannot send twice. */
export function Button({
  variant = "secondary",
  size = "md",
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
      className={buttonClass(variant, className, size)}
      data-variant={variant}
      data-size={size}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? "Working…" : children}
    </button>
  );
}
