"use client";

import type { StaffView } from "@loan/core";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { LoadState } from "@/components/load-state";
import { ApiError, api, errorMessage } from "./api";

const SessionContext = createContext<StaffView | null>(null);

/**
 * Loads the signed-in persona; a missing or expired session goes back to /sign-in. Any other
 * failure (API down, offline) is shown with a way to try again instead of waiting forever.
 */
export function SessionProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const router = useRouter();
  const [me, setMe] = useState<StaffView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api<StaffView>("/auth/me")
      .then((staff) => {
        if (!cancelled) setMe(staff);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) router.replace("/sign-in");
        else setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => load(), [load]);

  if (error) {
    return (
      <div className="p-8">
        <LoadState
          loading={false}
          error={error}
          onRetry={() => {
            setError(null);
            load();
          }}
        />
      </div>
    );
  }
  if (!me) return <>{fallback}</>;
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession(): StaffView {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used inside <SessionProvider>");
  return me;
}
