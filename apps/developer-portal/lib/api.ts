"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: { path: string; message: string }[]) {
    super(message);
  }
}

/** All dashboard calls go through the same-origin /api rewrite, so the session cookie stays first-party. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body || init.form ? "POST" : "GET"),
    credentials: "include",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.code ?? "error", json?.error?.message ?? `Request failed (${res.status})`, res.status, json?.error?.details);
  return json as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export const fmt = {
  date: (d: string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"),
  num: (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString()),
  bytes: (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`),
  usd: (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`,
};

export const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
