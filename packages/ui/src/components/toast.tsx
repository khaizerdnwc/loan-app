"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "../lib/cn";

type ToastKind = "ok" | "warn" | "bad";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null);

const KIND: Record<ToastKind, string> = {
  ok: "border-ok-700/30 bg-ok-050 text-ok-700",
  warn: "border-gold-600/30 bg-gold-050 text-gold-700",
  bad: "border-bad-700/30 bg-bad-050 text-bad-700",
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
            className={cn("rounded-btn border px-4 py-3 text-sm shadow-card", KIND[t.kind])}
          >
            {t.message}
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
