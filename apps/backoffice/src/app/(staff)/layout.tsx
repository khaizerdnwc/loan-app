"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/lib/session";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<p className="p-8 text-sm">Checking your session…</p>}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
