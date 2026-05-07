import type { Bet, PlaceBetPayload } from '@/types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json() as Promise<{ accessToken: string }>;
}

export async function register(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Registration failed');
  return res.json() as Promise<{ accessToken: string }>;
}

export async function placeBet(token: string, payload: PlaceBetPayload): Promise<Bet> {
  const res = await fetch(`${BASE}/bets`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to place bet');
  return res.json();
}

export async function fetchBets(token: string): Promise<Bet[]> {
  const res = await fetch(`${BASE}/bets`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch bets');
  return res.json();
}

export async function fetchBalance(token: string): Promise<number> {
  const res = await fetch(`${BASE}/wallet/balance`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('Failed to fetch balance');
  const { balance } = await res.json() as { balance: number };
  return balance;
}
