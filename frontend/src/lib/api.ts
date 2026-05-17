import type { Bet, PlaceBetPayload } from '@/types';

function baseUrl(): string {
  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function placeBet(token: string, payload: PlaceBetPayload): Promise<Bet> {
  const res = await fetch(`${baseUrl()}/bets`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to place bet');
  return res.json();
}

export async function fetchBets(token: string): Promise<Bet[]> {
  const res = await fetch(`${baseUrl()}/bets`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch bets');
  return res.json();
}

export async function fetchBalance(token: string): Promise<number> {
  const res = await fetch(`${baseUrl()}/wallet/balance`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch balance');
  const { balance } = await res.json() as { balance: number };
  return balance;
}
