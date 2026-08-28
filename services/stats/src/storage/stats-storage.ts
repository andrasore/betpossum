import type { SettlementRow } from "../stats/aggregate";

export interface LeaderboardEntry {
  userId: string;
  userName: string | null;
  roiPct: number;
  netProfitCents: number;
  settledCount: number;
}

export interface RecordSettlement {
  betId: string;
  userId: string;
  userName: string | null;
  settledAt: number;
  stakeCents: number;
  profitCents: number;
}

/**
 * Persistence for the read model. Pluggable via `STATS_STORAGE`; a new backend
 * is a new subclass wired through the factory in `storage.module.ts`.
 *
 * An abstract class rather than an interface so it doubles as the Nest DI
 * token.
 */
export abstract class StatsStorage {
  abstract recordSettlement(row: RecordSettlement): Promise<void>;
  abstract userRows(userId: string): Promise<SettlementRow[]>;
  abstract leaderboard(opts: {
    minSettled: number;
    limit: number;
  }): Promise<LeaderboardEntry[]>;
}
