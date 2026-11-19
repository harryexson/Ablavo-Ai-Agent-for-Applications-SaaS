"use client";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

export interface Me {
  user: { id: string; email: string; name: string; emailVerified: boolean; platformRole: string | null };
  organizations: { id: string; name: string; slug: string; type: string; role: string; plan: string | null; planName: string }[];
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  orgId: string | null;
  org: Me["organizations"][number] | null;
  setOrgId: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);
const ORG_KEY = "portal.orgId";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const m = await api<Me>("/v1/auth/me");
      setMe(m);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(ORG_KEY);
      } catch {
        /* storage unavailable */
      }
      setOrg(m.organizations.find((o) => o.id === saved)?.id ?? m.organizations[0]?.id ?? null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const setOrgId = (id: string) => {
    setOrg(id);
    try {
      localStorage.setItem(ORG_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const org = me?.organizations.find((o) => o.id === orgId) ?? null;
  return <Ctx.Provider value={{ me, loading, orgId, org, setOrgId, refresh }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
