import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Tone } from "./pill";

/**
 * The prototype's `.trig` box: an outcome, a referral reason, a waiting state or an error,
 * with a bold lead-in. One tile style for every such message; the tone follows the Pill's.
 * `alert` makes it a live error (role="alert"), for a failure the user just caused.
 */
const TONE: Record<Tone, { box: string; lead: string }> = {
  neutral: { box: "border-line bg-mist-050 text-mist-600", lead: "text-ink-900" },
  ok: { box: "border-ok-100 bg-ok-050 text-ok-700", lead: "text-ok-700" },
  warn: { box: "border-gold-200 bg-gold-050 text-gold-700", lead: "text-gold-700" },
  bad: { box: "border-bad-100 bg-bad-050 text-bad-700", lead: "text-bad-700" },
  info: { box: "border-info-100 bg-info-050 text-info-700", lead: "text-info-700" },
};

export function Callout({
  tone = "neutral",
  lead,
  alert = false,
  className,
  children,
}: {
  tone?: Tone;
  /** The bold opening words ("Auto-approved.", "Referred because:"). */
  lead?: ReactNode;
  alert?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      data-tone={tone}
      className={cn("rounded-card border px-4 py-3 text-sm", TONE[tone].box, className)}
    >
      {lead && <strong className={cn("font-bold", TONE[tone].lead)}>{lead}</strong>}
      {lead && children ? " " : null}
      {children}
    </div>
  );
}
