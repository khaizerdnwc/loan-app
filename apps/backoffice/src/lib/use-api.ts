"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, errorMessage } from "./api";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** The problem code of the last failure (e.g. FEATURE_DISABLED), when the API sent one. */
  errorCode: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Fetch one API resource for a screen, with loading and error state and a reload. */
export function useApi<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
      setErrorCode(null);
    } catch (e) {
      setError(errorMessage(e));
      setErrorCode(e instanceof ApiError ? e.code : null);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, errorCode, loading, reload };
}
