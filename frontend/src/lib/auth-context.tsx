"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
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
  // True until the initial silent bootstrap settles. Auth-gated pages must
  // wait this out before treating a null session as "anonymous" — otherwise a
  // full-page load of a protected route redirects before the background
  // restore lands.
  isLoading: boolean;
  accessToken: string | null;
  sub: string | null;
  name: string | null;
  roles: string[];
  login: (returnTo?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function getServerSnapshot() {
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useSyncExternalStore(
    subscribe,
    getSession,
    getServerSnapshot,
  );
  const [isLoading, setIsLoading] = useState(true);

  // First mount: if this browser was previously authenticated, attempt a
  // background silent refresh against Keycloak (hidden iframe, prompt=none) —
  // its session cookie makes the round-trip invisible if still signed in. We
  // stay in the loading state until that settles so gated pages don't redirect
  // prematurely; if it fails, refresh() clears the flag and we fall anonymous.
  useEffect(() => {
    if (session) {
      setIsLoading(false);
      return;
    }
    const path = window.location.pathname;
    // Skip the OIDC round-trip routes: /auth/callback finishes the interactive
    // flow itself, and /auth/silent runs inside the renew iframe (bootstrapping
    // there would recurse into a nested iframe).
    if (
      hasPreviousAuth() &&
      path !== "/auth/callback" &&
      path !== "/auth/silent"
    ) {
      void refresh().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [session]);

  const value: AuthValue = {
    isAuthenticated: session !== null,
    isLoading,
    accessToken: session?.accessToken ?? null,
    sub: session?.sub ?? null,
    name: session?.name ?? null,
    roles: session?.roles ?? [],
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
