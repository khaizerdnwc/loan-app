"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { formatAmountsInText } from "../lib/format";

type ToastKind = "ok" | "warn" | "bad";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null);

/** The prototype's toast: dark ink with white text and a coloured edge for its kind. */
const KIND: Record<ToastKind, string> = {
  ok: "border-l-ok-100",
  warn: "border-l-gold-500",
  bad: "border-l-bad-500",
};

/** Top-right notices, at most three, gone after four seconds (the prototype's behaviour). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback(
    (message: string, kind: ToastKind = "ok") => {
      const id = Date.now() + items.length;
      setItems((current) => [...current.slice(-2), { id, kind, message }]);
      setTimeout(() => setItems((current) => current.filter((t) => t.id !== id)), 4000);
    },
    [items.length],
  );
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            data-kind={t.kind}
            className={cn(
              "rounded-nav border-l-4 bg-ink-800 px-3.5 py-2.5 text-sm font-semibold text-white shadow-modal",
              KIND[t.kind],
            )}
          >
            {formatAmountsInText(t.message)}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string, kind?: ToastKind) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}
