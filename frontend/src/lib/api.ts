import type { Bet, OddsEvent, PlaceBetPayload } from "@/types";
import { getAccessToken, refresh } from "./auth";
import type { Outcome } from "./schemas";

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    refresh();
    throw new Error("Unauthenticated");
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    refresh();
    throw new Error("Unauthenticated");
  }
  return res;
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

export async function fetchOdds(): Promise<OddsEvent[]> {
  const res = await fetch("/odds");
  if (!res.ok) {
    throw new Error("Failed to fetch odds");
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
