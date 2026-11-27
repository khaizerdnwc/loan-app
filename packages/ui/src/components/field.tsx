import { type ComponentProps, cloneElement, type ReactElement, type ReactNode, useId } from "react";
import { cn } from "../lib/cn";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** One Input, Select or Textarea; the Field wires its id and aria attributes. */
  children: ReactElement<Record<string, unknown>>;
}

/** The one label style: small, uppercase, tracked (the prototype's form label). */
const LABEL = "text-2xs font-bold tracking-wider text-mist-500 uppercase";

/** A labelled form control with its hint and inline error, linked for assistive tech. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-mist-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-semibold text-bad-700">
          {error}
        </p>
      )}
    </div>
  );
}

/*
 * The one look of every form control: same border, radius, padding, 14px text, focus and
 * invalid styles. The classes stay private to this file and the controls take no className,
 * so a screen cannot drift from it.
 *
 * Heights at the 14px root (Tailwind spacing is 0.875× its 16px-root values):
 *   h-11     38.5px  Input and Select, the same as Button's min-h-11
 *   min-h-24 84px    Textarea, about three lines
 */
const CONTROL =
  "w-full rounded-btn border border-line bg-white px-3 text-base text-ink-900 " +
  "placeholder:text-mist-400 focus:border-gold-500 focus:outline-2 focus:outline-offset-0 " +
  "focus:outline-gold-500/40 aria-[invalid=true]:border-bad-500 disabled:cursor-not-allowed " +
  "disabled:bg-mist-050 disabled:text-mist-500";

const INPUT = cn(CONTROL, "h-11");
/** Room on the right for the native arrow. */
const SELECT = cn(CONTROL, "h-11 pr-8");
const TEXTAREA = cn(CONTROL, "min-h-24 resize-y py-2.5");

export function Input(props: Omit<ComponentProps<"input">, "className">) {
  return <input className={INPUT} {...props} />;
}

export function Select(props: Omit<ComponentProps<"select">, "className">) {
  return <select className={SELECT} {...props} />;
}

export function Textarea(props: Omit<ComponentProps<"textarea">, "className">) {
  return <textarea className={TEXTAREA} {...props} />;
}

/**
 * A labelled checkbox: the box and its sentence in one click target. Takes no className, like
 * the other controls; `invalid` marks it for assistive tech when a required box is unticked.
 */
export function Checkbox({
  label,
  invalid,
  ...props
}: Omit<ComponentProps<"input">, "className" | "type"> & { label: ReactNode; invalid?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-base text-ink-800">
      <input
        type="checkbox"
        aria-invalid={invalid ? true : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm accent-ink-800 aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-bad-500"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/** Fields side by side from the small breakpoint up, stacked on a phone; one gap everywhere. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** Fields stacked with the standard gap. */
export function FormStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}
