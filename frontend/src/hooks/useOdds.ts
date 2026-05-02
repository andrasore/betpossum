'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/websocket';
import type { OddsEvent } from '@/types';

export function useOdds(token: string | null) {
  const [odds, setOdds] = useState<Map<string, OddsEvent>>(new Map());

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);

    socket.on('odds.updated', (event: OddsEvent) => {
      setOdds((prev) => new Map(prev).set(event.event_id, event));
    });

    return () => { socket.off('odds.updated'); };
  }, [token]);

  return Array.from(odds.values());
}
