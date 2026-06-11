"use client";

import { decodeJwt } from "jose";
import {
  InMemoryWebStorage,
  type User,
  UserManager,
  type UserManagerSettings,
  WebStorageStateStore,
} from "oidc-client-ts";
import { z } from "zod";

const PREVIOUS_AUTH_EXISTS = "auth:previously-authed";

// Keycloak is fronted by nginx same-origin under /kc, and the realm/client are
// the same in every environment, so the whole config is derivable from the
// current origin — no runtime /config.js injection needed.
const KEYCLOAK_REALM = "betting";
const KEYCLOAK_CLIENT_ID = "betting-frontend";

interface Session {
  accessToken: string;
  idToken: string;
  expiresAt: number;
  sub: string;
  roles: string[];
}

// Public-facing view of the current auth state, kept as a synchronous snapshot
// so getAccessToken()/getSession() can be read during render and from the
// non-async fetch/socket paths. It mirrors the oidc-client-ts User, updated via
// UserManager events (see wireEvents).
let session: Session | null = null;
let manager: UserManager | null = null;
let refreshing = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    l();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession(): Session | null {
  return session;
}

export function getAccessToken(): string | null {
  return session?.accessToken ?? null;
}

const AccessClaimsSchema = z.object({
  sub: z.string(),
  realm_access: z.object({ roles: z.array(z.string()) }).optional(),
});

// Roles live in the access token's realm_access claim, not the ID-token
// profile, so we decode the access token ourselves rather than relying on
// oidc-client-ts's profile. decodeJwt only parses — the signature is verified
// server-side; these claims drive UI gating only.
function decodeAccess(jwt: string): { sub: string; roles: string[] } {
  const claims = AccessClaimsSchema.parse(decodeJwt(jwt));
  return { sub: claims.sub, roles: claims.realm_access?.roles ?? [] };
}

function toSession(user: User | null): Session | null {
  if (!user?.access_token || user.expired) {
    return null;
  }
  try {
    const { sub, roles } = decodeAccess(user.access_token);
    return {
      accessToken: user.access_token,
      idToken: user.id_token ?? "",
      expiresAt: (user.expires_at ?? 0) * 1000,
      sub,
      roles,
    };
  } catch {
    return null;
  }
}

function settings(): UserManagerSettings {
  const origin = window.location.origin;
  return {
    authority: `${origin}/kc/realms/${KEYCLOAK_REALM}`,
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: `${origin}/auth/callback`,
    silent_redirect_uri: `${origin}/auth/silent`,
    post_logout_redirect_uri: `${origin}/login`,
    response_type: "code",
    scope: "openid profile email",
    // Renews the access token in the background (hidden iframe, prompt=none)
    // ~60s before it expires, so an expiry no longer forces a top-level
    // navigation through Keycloak.
    automaticSilentRenew: true,
    // Tokens stay in JS memory only — never persisted to disk. A reload starts
    // with no user and re-bootstraps via signinSilent (see AuthProvider).
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    // The transient PKCE verifier/state must survive the redirect round-trip;
    // sessionStorage is also shared with the same-origin silent-renew iframe.
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // Roles come from the access token, not the UserInfo endpoint.
    loadUserInfo: false,
  };
}

function wireEvents(m: UserManager): void {
  // Every successful sign-in (interactive, silent, or renew) stores the user
  // and fires this — the single place the synchronous snapshot is refreshed.
  m.events.addUserLoaded((user) => {
    session = toSession(user);
    if (session) {
      localStorage.setItem(PREVIOUS_AUTH_EXISTS, "1");
    }
    notify();
  });
  m.events.addUserUnloaded(() => {
    session = null;
    notify();
  });
  // Fires only if a renew failed to land before expiry; the access token is now
  // unusable, so drop to anonymous.
  m.events.addAccessTokenExpired(() => {
    session = null;
    notify();
  });
  m.events.addUserSignedOut(() => {
    session = null;
    localStorage.removeItem(PREVIOUS_AUTH_EXISTS);
    notify();
  });
}

function mgr(): UserManager {
  if (!manager) {
    manager = new UserManager(settings());
    wireEvents(manager);
  }
  return manager;
}

export function login(returnTo?: string): void {
  const target = returnTo ?? window.location.pathname + window.location.search;
  void mgr().signinRedirect({ state: { returnTo: target } });
}

// Background silent refresh via a hidden same-origin iframe (prompt=none).
// Keycloak's session cookie is sent (real same-origin request, not 3rd-party),
// so it bounces straight back with a fresh token — no page navigation, in-flight
// UI state survives. On failure (login_required / no Keycloak session) we drop
// to anonymous rather than looping. self-guarded against concurrent calls.
export async function refresh(): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  try {
    await mgr().signinSilent();
  } catch {
    localStorage.removeItem(PREVIOUS_AUTH_EXISTS);
    session = null;
    notify();
  } finally {
    refreshing = false;
  }
}

interface CallbackResult {
  returnTo: string;
  error?: string;
}

// Completes the interactive Authorization-Code+PKCE redirect. The user is
// stored as a side effect (firing addUserLoaded), so we only need the returnTo
// carried through `state`.
export async function handleCallback(): Promise<CallbackResult> {
  try {
    const user = await mgr().signinRedirectCallback();
    const state = user.state as { returnTo?: string } | undefined;
    return { returnTo: state?.returnTo ?? "/" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "invalid_callback";
    if (/login_required/i.test(message)) {
      localStorage.removeItem(PREVIOUS_AUTH_EXISTS);
      return { returnTo: "/", error: "login_required" };
    }
    return { returnTo: "/", error: message };
  }
}

// Runs inside the silent-renew iframe: parses the prompt=none response and
// notifies the parent window's UserManager.
export async function silentCallback(): Promise<void> {
  await mgr().signinSilentCallback();
}

export function logout(): void {
  localStorage.removeItem(PREVIOUS_AUTH_EXISTS);
  session = null;
  notify();
  void mgr().signoutRedirect();
}

// True if the browser previously held a successful session — used by the
// AuthProvider to attempt a silent refresh on bootstrap.
export function hasPreviousAuth(): boolean {
  return localStorage.getItem(PREVIOUS_AUTH_EXISTS) === "1";
}
