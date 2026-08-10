export type { OddsEvent } from "@/generated/events";

// All money is integer cents; only `src/lib/money.ts` turns it into dollars.
export interface Bet {
  id: string;
  eventId: string;
  selection: "home" | "away" | "draw";
  odds: number;
  stakeCents: number;
  // Profit only, not total return.
  payoutCents: number | null;
  status: "pending" | "held" | "won" | "lost";
  placedAt: string;
}

export interface PlaceBetPayload {
  eventId: string;
  selection: "home" | "away" | "draw";
  odds: number;
  stakeCents: number;
}

// One point of the cumulative-ROI% series (one per active UTC day).
export interface PnlPoint {
  date: string;
  roiPct: number;
}

export interface StatsSummary {
  totalStakedCents: number;
  settledCount: number;
  wins: number;
  winRatePct: number;
  netProfitCents: number;
  roiPct: number;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string | null;
  roiPct: number;
  netProfitCents: number;
  settledCount: number;
}
