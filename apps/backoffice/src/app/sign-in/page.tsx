"use client";

import type { StaffView } from "@loan/core";
import { Button, Card, Field, inputClass } from "@loan/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { landingFor } from "@/lib/navigation";

/**
 * Test sign-in (Program Mechanics 1a): a seeded username and the test password. The accounts
 * are documented in docs/TEST-ACCOUNTS.md; the page itself lists none.
 */
export default function SignInPage() {
  const router = useRouter();
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="font-mono text-xs tracking-wide text-gold-700 uppercase">WhiteBank Lending</p>
        <h1 className="mt-1 text-[32px] leading-tight font-extrabold">Sign in</h1>
        <p className="mt-2 text-sm">
          Test accounts only. Every applicant is synthetic and every external service is simulated.
        </p>
        <p className="mt-1 text-sm text-mist-500">
          The test usernames and password are in{" "}
          <span className="font-mono">docs/TEST-ACCOUNTS.md</span> in the repository.
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
    </main>
  );
}
