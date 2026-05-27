"use client";

import { decodeJwt } from "jose";
import { z } from "zod";

const PENDING_KEY = "auth:pending";
const PREVIOUS_AUTH_KEY = "auth:previously-authed";

interface PendingAuth {
  verifier: string;
  state: string;
  returnTo: string;
}

interface Session {
  accessToken: string;
  idToken: string;
  expiresAt: number;
  sub: string;
  roles: string[];
}

interface AppConfig {
  keycloakIssuer: string;
  clientId: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: AppConfig;
  }
}

let session: Session | null = null;
let refreshing = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
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

function config(): AppConfig {
  const cfg = window.__APP_CONFIG__;
  if (!cfg) throw new Error("window.__APP_CONFIG__ not loaded");
  return cfg;
}

function redirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return new Uint8Array(buf);
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
  id_token: z.string().optional(),
  expires_in: z.number(),
});

const AccessClaimsSchema = z.object({
  sub: z.string(),
  realm_access: z.object({ roles: z.array(z.string()) }).optional(),
});

function decodeAccess(jwt: string): { sub: string; roles: string[] } {
  const claims = AccessClaimsSchema.parse(decodeJwt(jwt));
  return { sub: claims.sub, roles: claims.realm_access?.roles ?? [] };
}

async function startFlow(opts: {
  silent: boolean;
  returnTo?: string;
}): Promise<void> {
  const { keycloakIssuer, clientId } = config();
  const verifier = randomString();
  const state = randomString();
  const challenge = base64UrlEncode(await sha256(verifier));
  const returnTo =
    opts.returnTo ?? window.location.pathname + window.location.search;

  const pending: PendingAuth = { verifier, state, returnTo };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (opts.silent) params.set("prompt", "none");

  window.location.assign(
    `${keycloakIssuer}/protocol/openid-connect/auth?${params}`,
  );
}

export function login(returnTo?: string): void {
  void startFlow({ silent: false, returnTo });
}

// Reactive refresh via top-level navigation. Keycloak's session cookie (sent
// because this is a real navigation, not an iframe) makes prompt=none either
// bounce straight back with a fresh code, or fail with error=login_required —
// in which case the callback page falls back to interactive login.
export function refresh(): void {
  if (refreshing) return;
  refreshing = true;
  void startFlow({ silent: true });
}

interface CallbackResult {
  returnTo: string;
  error?: string;
}

export async function handleCallback(): Promise<CallbackResult> {
  const params = new URLSearchParams(window.location.search);
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (!raw) return { returnTo: "/", error: "missing_pending_state" };
  const pending = JSON.parse(raw) as PendingAuth;

  const error = params.get("error");
  if (error) {
    refreshing = false;
    // login_required after a prompt=none attempt = no Keycloak session;
    // forget that we were ever logged in so we don't loop on next reload.
    if (error === "login_required") {
      localStorage.removeItem(PREVIOUS_AUTH_KEY);
    }
    return { returnTo: pending.returnTo, error };
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || state !== pending.state) {
    return { returnTo: pending.returnTo, error: "invalid_callback" };
  }

  const { keycloakIssuer, clientId } = config();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  const res = await fetch(`${keycloakIssuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    refreshing = false;
    return {
      returnTo: pending.returnTo,
      error: `token_exchange_${res.status}`,
    };
  }
  const json = TokenResponseSchema.parse(await res.json());
  const { sub, roles } = decodeAccess(json.access_token);

  session = {
    accessToken: json.access_token,
    idToken: json.id_token ?? "",
    expiresAt: Date.now() + json.expires_in * 1000,
    sub,
    roles,
  };
  refreshing = false;
  localStorage.setItem(PREVIOUS_AUTH_KEY, "1");
  notify();

  return { returnTo: pending.returnTo };
}

export function logout(): void {
  const { keycloakIssuer, clientId } = config();
  const idToken = session?.idToken;
  session = null;
  localStorage.removeItem(PREVIOUS_AUTH_KEY);
  notify();

  const params = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
  if (idToken) params.set("id_token_hint", idToken);
  window.location.assign(
    `${keycloakIssuer}/protocol/openid-connect/logout?${params}`,
  );
}

// True if the browser previously held a successful session — used by the
// AuthProvider to attempt a silent refresh on bootstrap.
export function hasPreviousAuth(): boolean {
  return localStorage.getItem(PREVIOUS_AUTH_KEY) === "1";
}
