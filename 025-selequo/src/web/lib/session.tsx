import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from './api';
import type { Role } from '@shared/types';

export interface Me {
  user: { id: string; email: string; name: string };
  csrf: string;
  workspaces: { id: string; name: string; role: Role; isSample: boolean }[];
  ai: { configured: boolean; provider: string | null };
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue>({ me: null, loading: true, refresh: async () => null, logout: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('GET', '/api/auth/me');
      setCsrf(m.csrf);
      setMe(m);
      return m;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout');
    setMe(null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export function useRole(ws: string | undefined): Role | null {
  const { me } = useSession();
  return me?.workspaces.find((w) => w.id === ws)?.role ?? null;
}

const RANK: Record<Role, number> = { owner: 50, admin: 40, editor: 30, reviewer: 20, viewer: 10 };
export const can = (role: Role | null, min: Role) => !!role && RANK[role] >= RANK[min];
