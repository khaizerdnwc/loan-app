"use client";

import { ROLE_LABEL, type StaffView } from "@loan/core";
import { Button, Card, formatPeso } from "@loan/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { landingFor } from "@/lib/navigation";
import { useApi } from "@/lib/use-api";

/**
 * Demo access (mechanics 1a): pick a seeded persona. There are no passwords — anyone who can
 * reach this app can sign in as any persona, which is a stated limitation of the demo.
 */
export default function SignInPage() {
  const router = useRouter();
  const personas = useApi<StaffView[]>("/auth/personas");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(staff: StaffView) {
    setBusyId(staff.id);
    setError(null);
    try {
      await api<StaffView>("/auth/demo-login", { method: "POST", body: { staffId: staff.id } });
      router.push(landingFor(staff.role));
    } catch (e) {
      setError(errorMessage(e));
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="font-mono text-xs tracking-wide text-gold-700 uppercase">WhiteBank Lending</p>
        <h1 className="mt-1 text-[32px] leading-tight font-extrabold">Sign in</h1>
        <p className="mt-2 text-sm">
          Demo access: choose a staff persona. Every applicant is synthetic and every external
          service is simulated.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-btn bg-bad-050 px-4 py-3 text-sm text-bad-700">
          {error}
        </p>
      )}
      <Card title="Staff personas" aside="Demo access">
        {personas.loading && <p className="text-sm">Loading personas…</p>}
        {personas.error && (
          <p role="alert" className="text-sm text-bad-700">
            {personas.error}
          </p>
        )}
        {personas.data && personas.data.length === 0 && (
          <p className="text-sm">No personas are seeded yet.</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {personas.data?.map((staff) => (
            <li
              key={staff.id}
              className="flex items-center justify-between gap-3 rounded-btn border border-line p-3"
            >
              <div>
                <p className="font-semibold text-ink-900">{staff.fullName}</p>
                <p className="text-xs">{ROLE_LABEL[staff.role]}</p>
                {staff.approvalLimit && (
                  <p className="text-xs text-mist-500">
                    Authority {formatPeso(staff.approvalLimit)} · grades{" "}
                    {staff.approvalGrades?.join(", ")}
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                busy={busyId === staff.id}
                disabled={busyId !== null && busyId !== staff.id}
                onClick={() => signIn(staff)}
                aria-label={`Sign in as ${staff.fullName}`}
              >
                Sign in
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
