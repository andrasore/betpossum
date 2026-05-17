import type { Bet, PlaceBetPayload } from '@/types';
import { logout, refreshAccessToken } from '@/lib/keycloak';

function baseUrl(): string {
  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

function send(path: string, init: RequestInit | undefined, token: string): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('token');
  if (!token) {
    logout();
    throw new Error('Session expired');
  }

  const res = await send(path, init, token);
  if (res.status !== 401) return res;

  let fresh: string;
  try {
    fresh = await refreshAccessToken();
  } catch {
    logout();
    throw new Error('Session expired');
  }

  const retry = await send(path, init, fresh);
  if (retry.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  return retry;
}

export async function placeBet(payload: PlaceBetPayload): Promise<Bet> {
  const res = await authedFetch('/bets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to place bet');
  return res.json();
}

export async function fetchBets(): Promise<Bet[]> {
  const res = await authedFetch('/bets');
  if (!res.ok) throw new Error('Failed to fetch bets');
  return res.json();
}

export async function fetchBalance(): Promise<number> {
  const res = await authedFetch('/wallet/balance');
  if (!res.ok) throw new Error('Failed to fetch balance');
  const { balance } = await res.json() as { balance: number };
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
  const res = await authedFetch('/admin/users');
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export async function setAdminUserBalance(userId: string, amount: number): Promise<void> {
  const res = await authedFetch(`/admin/users/${userId}/balance`, {
    method: 'PUT',
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) throw new Error('Failed to update balance');
}
