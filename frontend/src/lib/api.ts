import type { Bet, OddsEvent, PlaceBetPayload } from "@/types";
import { getAccessToken, refresh } from "./auth";
import type { League, Outcome, Sport } from "./schemas";

async function send(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    void refresh();
    throw new Error("Unauthenticated");
  }
  return res;
}

// Core lazily provisions the user row (and wallet) on the first authed request
// it sees. A new user's dashboard fires several authed calls at once (e.g.
// /bets and /wallet/balance), and two of them racing that create would make
// one fail on the primary key. So serialize the first authed request: the very
// first caller runs alone while everyone else waits on it, and once it lands —
// by which point the row exists — traffic flows in parallel as normal.
let bootstrap: Promise<void> | null = null;
let provisioned = false;

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    void refresh();
    throw new Error("Unauthenticated");
  }

  if (!provisioned) {
    if (bootstrap) {
      // A first request is already in flight — wait for it, then proceed.
      await bootstrap;
    } else {
      // We are the first request: hold the gate, run alone, release on settle.
      let release!: () => void;
      bootstrap = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const res = await send(url, token, init);
        provisioned = true;
        return res;
      } finally {
        release();
        bootstrap = null;
      }
    }
  }

  return send(url, token, init);
}

function api(path: string, init?: RequestInit): Promise<Response> {
  return authedFetch(`/api${path}`, init);
}

export async function placeBet(payload: PlaceBetPayload): Promise<Bet> {
  const res = await api("/bets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Failed to place bet");
  }
  return res.json();
}

export async function fetchBets(): Promise<Bet[]> {
  const res = await api("/bets");
  if (!res.ok) {
    throw new Error("Failed to fetch bets");
  }
  return res.json();
}

export async function fetchOdds(
  sport?: string,
  league?: number,
): Promise<OddsEvent[]> {
  const params = new URLSearchParams();
  if (sport) {
    params.set("sport", sport);
  }
  if (league !== undefined) {
    params.set("league", String(league));
  }
  const query = params.toString();
  const res = await fetch(`/odds${query ? `?${query}` : ""}`);
  if (!res.ok) {
    throw new Error("Failed to fetch odds");
  }
  return res.json();
}

export async function fetchSports(): Promise<Sport[]> {
  const res = await fetch("/odds/sports");
  if (!res.ok) {
    throw new Error("Failed to fetch sports");
  }
  return res.json();
}

export async function fetchLeagues(sport?: string): Promise<League[]> {
  const query = sport ? `?sport=${encodeURIComponent(sport)}` : "";
  const res = await fetch(`/odds/leagues${query}`);
  if (!res.ok) {
    throw new Error("Failed to fetch leagues");
  }
  return res.json();
}

export async function fetchBalance(): Promise<number> {
  const res = await api("/wallet/balance");
  if (!res.ok) {
    throw new Error("Failed to fetch balance");
  }
  const { balance } = (await res.json()) as { balance: number };
  return balance;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  betCount: number;
  balance: number;
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const res = await api("/admin/users");
  if (!res.ok) {
    throw new Error("Failed to fetch users");
  }
  return res.json();
}

export async function setAdminUserBalance(
  userId: string,
  amount: number,
): Promise<void> {
  const res = await api(`/admin/users/${userId}/balance`, {
    method: "PUT",
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) {
    throw new Error("Failed to update balance");
  }
}

export async function resolveAdminEvent(
  eventId: string,
  outcome: Outcome,
): Promise<void> {
  const res = await authedFetch(`/odds/${eventId}/result`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
  if (!res.ok) {
    throw new Error("Failed to resolve event");
  }
}
