import { cloneElement, type ReactElement, useId } from "react";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** One input, select or textarea; the Field wires its id and aria attributes. */
  children: ReactElement<Record<string, unknown>>;
}

/** A labelled form control with its hint and inline error, linked for assistive tech. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[10.5px] font-semibold tracking-wide text-mist-500 uppercase"
      >
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
        <p id={errorId} className="text-xs font-medium text-bad-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared classes for inputs, selects and textareas. */
export const inputClass =
  "w-full rounded-btn border border-line bg-white px-3 py-2 text-sm text-ink-900 focus:border-gold-500 focus:outline-2 focus:outline-gold-500/40 aria-[invalid=true]:border-bad-500";
