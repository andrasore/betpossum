"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import {
  getSession,
  hasPreviousAuth,
  login,
  logout,
  refresh,
  subscribe,
} from "./auth";

interface AuthValue {
  isAuthenticated: boolean;
  accessToken: string | null;
  sub: string | null;
  roles: string[];
  login: (returnTo?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function getServerSnapshot() {
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useSyncExternalStore(subscribe, getSession, getServerSnapshot);

  // First mount: if this browser was previously authenticated, attempt a
  // silent refresh against Keycloak. Top-level navigation, so Keycloak's
  // session cookie is sent and the round-trip is invisible if the session is
  // still alive. If it isn't, the callback page clears the flag.
  useEffect(() => {
    if (session) return;
    if (hasPreviousAuth() && window.location.pathname !== "/auth/callback") {
      refresh();
    }
  }, [session]);

  const value: AuthValue = {
    isAuthenticated: session !== null,
    accessToken: session?.accessToken ?? null,
    sub: session?.sub ?? null,
    roles: session?.roles ?? [],
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
