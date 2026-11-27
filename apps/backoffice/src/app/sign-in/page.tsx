"use client";

import { ROLE_LABEL, type StaffView } from "@loan/core";
import { Button, Card, Field, formatPeso, inputClass } from "@loan/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { landingFor } from "@/lib/navigation";
import { useApi } from "@/lib/use-api";

/**
 * Test sign-in (Program Mechanics 1a): a seeded username and its test password. The list of
 * test accounts below only fills in the username — the password is always typed.
 */
export default function SignInPage() {
  const router = useRouter();
  const personas = useApi<StaffView[]>("/auth/personas");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ username?: string; password?: string }>({});
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const blank = {
      username: username.trim() ? undefined : "Enter your username.",
      password: password ? undefined : "Enter your password.",
    };
    setMissing(blank);
    if (blank.username || blank.password) {
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await api<StaffView>("/auth/sign-in", {
        method: "POST",
        body: { username: username.trim(), password },
      });
      router.push(landingFor(me.role));
    } catch (err) {
      // One message for every refusal: it must not say which field was wrong.
      setError(errorMessage(err));
      setPassword("");
      setBusy(false);
      passwordRef.current?.focus();
    }
  }

  function choose(staff: StaffView) {
    setUsername(staff.username);
    setPassword("");
    setError(null);
    setMissing({});
    passwordRef.current?.focus();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="font-mono text-xs tracking-wide text-gold-700 uppercase">WhiteBank Lending</p>
        <h1 className="mt-1 text-[32px] leading-tight font-extrabold">Sign in</h1>
        <p className="mt-2 text-sm">
          Test accounts only. Every applicant is synthetic and every external service is simulated.
        </p>
      </div>
      <Card title="Staff sign-in">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && (
            <p role="alert" className="rounded-btn bg-bad-050 px-4 py-3 text-sm text-bad-700">
              {error}
            </p>
          )}
          <Field label="Username" error={missing.username}>
            <input
              className={inputClass}
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Password" error={missing.password}>
            <input
              ref={passwordRef}
              className={inputClass}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" busy={busy}>
              Sign in
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Test accounts" aside="Fills in the username">
        {personas.loading && <p className="text-sm">Loading test accounts…</p>}
        {personas.error && (
          <p role="alert" className="text-sm text-bad-700">
            {personas.error}
          </p>
        )}
        {personas.data && personas.data.length === 0 && (
          <p className="text-sm">No staff are seeded yet.</p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {personas.data?.map((staff) => (
            <li
              key={staff.id}
              className="flex items-center justify-between gap-3 rounded-btn border border-line p-3"
            >
              <div>
                <p className="font-semibold text-ink-900">{staff.fullName}</p>
                <p className="text-xs">
                  {ROLE_LABEL[staff.role]} · <span className="font-mono">{staff.username}</span>
                </p>
                {staff.approvalLimit && (
                  <p className="text-xs text-mist-500">
                    Authority {formatPeso(staff.approvalLimit)} · grades{" "}
                    {staff.approvalGrades?.join(", ")}
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() => choose(staff)}
                aria-label={`Use ${staff.fullName}'s username`}
              >
                Use
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
