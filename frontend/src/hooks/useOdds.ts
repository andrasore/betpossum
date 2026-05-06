'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/websocket';
import { OddsEventSchema } from '@/lib/schemas';
import type { OddsEvent } from '@/types';

export function useOdds(token: string | null) {
  const [odds, setOdds] = useState<Map<string, OddsEvent>>(new Map());

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);

    socket.on('odds.updated', (raw: unknown) => {
      const result = OddsEventSchema.safeParse(raw);
      if (!result.success) {
        console.warn('[useOdds] Invalid odds event:', result.error.flatten());
        return;
      }
      const event = result.data;
      setOdds((prev) => new Map(prev).set(event.eventId, event));
    });

    return () => { socket.off('odds.updated'); };
  }, [token]);

  return Array.from(odds.values());
}
