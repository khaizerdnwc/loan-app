"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button, type ButtonVariant } from "./button";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  /** While true, Escape does not close the dialog (a request is in flight). */
  busy?: boolean;
}

/**
 * A modal built on the native <dialog>: focus moves into it, Escape closes it, and the page
 * behind is inert — keyboard-reachable without a library. When it closes or unmounts, focus
 * returns to whatever opened it.
 */
export function Modal({ open, title, description, onClose, children, footer, busy }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      return;
    }
    // Remember the opener before showModal() moves focus into the dialog.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => {
      // Close first: while the dialog is modal the page behind it is inert and cannot
      // take focus (a mounted dialog toggled to open=false runs this cleanup before close).
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-card border border-line bg-white p-0 text-ink-800 shadow-modal backdrop:bg-ink-900/40"
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-bold text-ink-900">
            {title}
          </h2>
          {description && (
            <div id={descriptionId} className="mt-1 text-sm text-mist-600">
              {description}
            </div>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in words: amount, tenor, who is affected. */
  description: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  busy?: boolean;
  /** A readable error from the last attempt, shown inline. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** Every consequential action goes through this: it states what will happen first. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  variant = "primary",
  busy = false,
  error,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && (
        <p role="alert" className="mt-3 rounded-btn bg-bad-050 px-3 py-2 text-sm text-bad-700">
          {error}
        </p>
      )}
    </Modal>
  );
}
