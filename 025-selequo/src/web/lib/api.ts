// Small API client: session cookie + CSRF header, JSON in/out, workspace-scoped helpers.
import { useCallback, useEffect, useRef, useState } from 'react';

let csrf = '';
export const setCsrf = (t: string) => {
  csrf = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', ...init });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { message?: string })?.message ?? `HTTP ${res.status}`, (data as { details?: unknown })?.details);
  return data as T;
}

export const wsApi = (ws: string) => ({
  get: <T = any>(p: string) => api<T>('GET', `/api/w/${ws}${p}`),
  post: <T = any>(p: string, b?: unknown) => api<T>('POST', `/api/w/${ws}${p}`, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => api<T>('PATCH', `/api/w/${ws}${p}`, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => api<T>('PUT', `/api/w/${ws}${p}`, b ?? {}),
  del: <T = any>(p: string) => api<T>('DELETE', `/api/w/${ws}${p}`),
  url: (p: string) => `/api/w/${ws}${p}`,
});

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>('GET', path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Poll while a condition holds (e.g. sources still processing). */
export function usePoll(active: boolean, fn: () => void, ms = 1500) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [active, fn, ms]);
}
