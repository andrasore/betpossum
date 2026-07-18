// Keycloak helpers: master-account provisioning via the Admin REST API, plus
// realm password-grant login/refresh for the bots and the funding admin. All
// traffic goes through the single nginx origin under /kc.

import type { Config } from "./config.js";
import type { GeneratedName } from "./names.js";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  // Epoch ms when the access token expires.
  expiresAt: number;
}

function tokenUrl(cfg: Config, realm: string): string {
  return `${cfg.baseUrl}/kc/realms/${realm}/protocol/openid-connect/token`;
}

function adminBase(cfg: Config): string {
  return `${cfg.baseUrl}/kc/admin/realms/${cfg.realm}`;
}

function toSession(token: TokenResponse): Session {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

async function requestToken(
  url: string,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(
      `Token request failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as Promise<TokenResponse>;
}

// Master-realm admin token (admin-cli) used purely to provision the realm.
export async function getMasterToken(cfg: Config): Promise<Session> {
  const token = await requestToken(tokenUrl(cfg, "master"), {
    grant_type: "password",
    client_id: "admin-cli",
    username: cfg.kcAdmin,
    password: cfg.kcAdminPassword,
  });
  return toSession(token);
}

// Idempotently create the public direct-grant client the bots authenticate
// against. Safe to re-run: returns early if the client already exists.
export async function ensureBotsClient(
  cfg: Config,
  masterToken: string,
): Promise<void> {
  const lookup = await fetch(
    `${adminBase(cfg)}/clients?clientId=${encodeURIComponent(cfg.clientId)}`,
    { headers: { Authorization: `Bearer ${masterToken}` } },
  );
  if (!lookup.ok) {
    throw new Error(
      `Client lookup failed (${lookup.status}): ${await lookup.text()}`,
    );
  }
  const existing = (await lookup.json()) as unknown[];
  if (existing.length > 0) {
    return;
  }
  const create = await fetch(`${adminBase(cfg)}/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterToken}`,
    },
    body: JSON.stringify({
      clientId: cfg.clientId,
      enabled: true,
      publicClient: true,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      serviceAccountsEnabled: false,
    }),
  });
  if (!create.ok) {
    throw new Error(
      `Client create failed (${create.status}): ${await create.text()}`,
    );
  }
}

// Idempotently create one enabled realm user with an inline (non-temporary)
// password. Returns true if it created the user, false if it already existed, so
// a restart reuses the same bots instead of minting a fresh pool. The realm's
// default-roles-betting already grants the `user` role.
export async function ensureBotUser(
  cfg: Config,
  masterToken: string,
  name: GeneratedName,
): Promise<boolean> {
  const lookup = await fetch(
    `${adminBase(cfg)}/users?username=${encodeURIComponent(name.username)}&exact=true`,
    { headers: { Authorization: `Bearer ${masterToken}` } },
  );
  if (!lookup.ok) {
    throw new Error(
      `User lookup failed (${lookup.status}): ${await lookup.text()}`,
    );
  }
  const existing = (await lookup.json()) as unknown[];
  if (existing.length > 0) {
    return false;
  }
  const res = await fetch(`${adminBase(cfg)}/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterToken}`,
    },
    body: JSON.stringify({
      username: name.username,
      firstName: name.firstName,
      lastName: name.lastName,
      email: name.email,
      enabled: true,
      emailVerified: true,
      credentials: [
        { type: "password", value: cfg.botPassword, temporary: false },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`User create failed (${res.status}): ${await res.text()}`);
  }
  return true;
}

export async function login(
  cfg: Config,
  username: string,
  password: string,
): Promise<Session> {
  const token = await requestToken(tokenUrl(cfg, cfg.realm), {
    grant_type: "password",
    client_id: cfg.clientId,
    username,
    password,
  });
  return toSession(token);
}

export async function refreshSession(
  cfg: Config,
  session: Session,
): Promise<Session> {
  const token = await requestToken(tokenUrl(cfg, cfg.realm), {
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    refresh_token: session.refreshToken,
  });
  return toSession(token);
}

// Read the `sub` claim (the Core user id) from a JWT without verifying it — the
// services do the real verification; we only need the id for the admin path.
export function decodeSub(accessToken: string): string {
  const payload = accessToken.split(".")[1];
  if (!payload) {
    throw new Error("Malformed access token");
  }
  const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const sub = json.sub;
  if (typeof sub !== "string") {
    throw new Error("Access token has no sub claim");
  }
  return sub;
}
