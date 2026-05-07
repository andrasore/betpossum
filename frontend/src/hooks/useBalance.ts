'use client';

import { useEffect, useState } from 'react';
import { fetchBalance } from '@/lib/api';
import { getSocket } from '@/lib/websocket';

export function useBalance(token: string | null) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;

    fetchBalance(token).then(setBalance).catch(() => {});

    const socket = getSocket(token);
    socket.on('balance.updated', ({ balance: b }: { balance: number }) => setBalance(b));
    return () => { socket.off('balance.updated'); };
  }, [token]);

  return balance;
}
