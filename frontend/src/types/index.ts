export type { OddsEvent } from "@/generated/events";

export interface Bet {
  id: string;
  eventId: string;
  selection: "home" | "away" | "draw";
  odds: number;
  stake: number;
  payout: number | null;
  status: "pending" | "held" | "won" | "lost";
  placedAt: string;
}

export interface PlaceBetPayload {
  eventId: string;
  selection: "home" | "away" | "draw";
  odds: number;
  stake: number;
}

// One point of the cumulative-ROI% series (one per active UTC day).
export interface PnlPoint {
  date: string;
  roiPct: number;
}

export interface StatsSummary {
  totalStaked: number;
  settledCount: number;
  wins: number;
  winRatePct: number;
  netProfit: number;
  roiPct: number;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string | null;
  roiPct: number;
  netProfit: number;
  settledCount: number;
}
