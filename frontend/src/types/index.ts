export interface OddsEvent {
  event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  home_odds: number;
  away_odds: number;
  draw_odds: number;
  updated_at: number;
}

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
