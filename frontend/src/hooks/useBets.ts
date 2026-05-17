'use client';

import useSWR from 'swr';
import { fetchBets } from '@/lib/api';
import type { Bet } from '@/types';

export function useBets(token: string | null) {
  return useSWR<Bet[]>(
    token ? 'bets' : null,
    () => fetchBets(),
    { refreshInterval: 10_000 },
  );
}
