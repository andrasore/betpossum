// Thin HTTP client over the public nginx origin. Mirrors the shapes the SPA uses
// (frontend/src/lib/api.ts); only the handful of endpoints the bots need.

import type { Config } from "./config.js";

export type Selection = "home" | "away" | "draw";

// Subset of the `/odds` OddsEvent contract (schemas/json/rest.json) the bots read.
export interface OddsEvent {
  eventId: string;
  homeOdds: number;
  awayOdds: number;
  drawOdds?: number;
  commenceTime?: number | null;
  outcome?: Selection | null;
}

export interface PlaceBetPayload {
  eventId: string;
  selection: Selection;
  odds: number;
  stake: number;
}

async function asError(prefix: string, res: Response): Promise<Error> {
  return new Error(`${prefix} (${res.status}): ${await res.text()}`);
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function getOdds(cfg: Config): Promise<OddsEvent[]> {
  const res = await fetch(`${cfg.baseUrl}/odds/events`);
  if (!res.ok) {
    throw await asError("Fetch odds failed", res);
  }
  return res.json() as Promise<OddsEvent[]>;
}

export async function getBalance(cfg: Config, token: string): Promise<number> {
  const res = await fetch(`${cfg.baseUrl}/api/wallet/balance`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw await asError("Fetch balance failed", res);
  }
  const { balance } = (await res.json()) as { balance: number };
  return balance;
}

export async function placeBet(
  cfg: Config,
  token: string,
  payload: PlaceBetPayload,
): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/api/bets`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await asError("Place bet failed", res);
  }
}

// Admin-only: set a user's wallet balance (requires the `admin` realm role).
export async function setBalance(
  cfg: Config,
  adminToken: string,
  userId: string,
  amount: number,
): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/api/admin/users/${userId}/balance`, {
    method: "PUT",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) {
    throw await asError("Set balance failed", res);
  }
}
