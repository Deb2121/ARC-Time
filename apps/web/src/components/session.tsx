"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { ApiError, api, type Me, setCsrfToken } from "@/lib/api";

const SessionCtx = createContext<Me | null>(null);

/** Loads the signed-in user; redirects to /login when there is no session. */
export function SessionGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const m = await api<Me>("/me");
      setCsrfToken(m.csrfToken);
      return m;
    },
    retry: false,
  });
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);
  if (!me.data) return <>{fallback}</>;
  return <SessionCtx.Provider value={me.data}>{children}</SessionCtx.Provider>;
}

export function useMe(): Me {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("useMe outside SessionGate");
  return v;
}
