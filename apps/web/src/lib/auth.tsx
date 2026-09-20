import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Household, User } from "@compra/shared";
import { api, ApiError, tokenStore, UNAUTHORIZED_EVENT } from "./api";
import { outbox } from "./outbox";
import { clearLocalData } from "./store";

interface AuthState {
  user: User | null;
  household: Household | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const hasToken = !!tokenStore.get();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    enabled: hasToken,
    retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 2,
  });

  const clear = useCallback(async () => {
    tokenStore.clear();
    qc.clear();
    await outbox.reset();
    await clearLocalData();
  }, [qc]);

  useEffect(() => {
    const onUnauthorized = () => { void clear().then(() => window.location.assign("/entrar")); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [clear]);

  const value = useMemo<AuthState>(() => ({
    user: me.data?.user ?? null,
    household: me.data?.household ?? null,
    loading: hasToken && me.isPending,
    signIn: async (token) => {
      tokenStore.set(token);
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.fetchQuery({ queryKey: ["me"], queryFn: api.me });
    },
    signOut: async () => {
      // Antes de salir, se intenta enviar lo que quedara pendiente para no perderlo.
      await outbox.flush().catch(() => undefined);
      await api.logout().catch(() => undefined);
      await clear();
      window.location.assign("/entrar");
    },
  }), [me.data, me.isPending, hasToken, qc, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fuera de AuthProvider");
  return v;
}
