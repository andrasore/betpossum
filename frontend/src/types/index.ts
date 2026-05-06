export type { OddsEvent } from '@/lib/schemas';

export interface Bet {
  id: string;
  eventId: string;
  selection: 'home' | 'away' | 'draw';
  odds: number;
  stake: number;
  payout: number | null;
  status: 'pending' | 'held' | 'won' | 'lost';
  placedAt: string;
}

export interface PlaceBetPayload {
  eventId: string;
  selection: 'home' | 'away' | 'draw';
  odds: number;
  stake: number;
}
