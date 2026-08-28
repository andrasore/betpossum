import { Injectable } from "@nestjs/common";
import type { Repository } from "typeorm";
import { round2 } from "../common/round";
import type { SettlementRow } from "../stats/aggregate";
import { Settlement } from "./settlement.entity";
import {
  type LeaderboardEntry,
  type RecordSettlement,
  StatsStorage,
} from "./stats-storage";

/**
 * Postgres read store for the stats read model.
 *
 * Owns a single table, `stats_settlements` — one row per settled bet, keyed by
 * `bet_id` so redelivery of the durable `bets.settled` event is idempotent
 * (ON CONFLICT DO NOTHING). Nothing here reads Core's or Odds' tables; the
 * event is the only input.
 */
@Injectable()
export class PostgresStorage extends StatsStorage {
  constructor(private readonly repo: Repository<Settlement>) {
    super();
  }

  /** Upsert a settlement; a duplicate betId is a no-op (exactly-once). */
  async recordSettlement(row: RecordSettlement): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(Settlement)
      .values(row)
      // DO NOTHING, not DO UPDATE: on redelivery the existing row wins, so a
      // stale replay can never overwrite or double-count a settlement.
      .orIgnore()
      .execute();
  }

  async userRows(userId: string): Promise<SettlementRow[]> {
    const rows = await this.repo.find({
      where: { userId },
      order: { settledAt: "ASC" },
    });
    return rows.map((r) => ({
      settledAt: r.settledAt,
      stakeCents: r.stakeCents,
      profitCents: r.profitCents,
    }));
  }

  async leaderboard({
    minSettled,
    limit,
  }: {
    minSettled: number;
    limit: number;
  }): Promise<LeaderboardEntry[]> {
    // Demo scale: read the settlements and aggregate per user in process.
    // Not just inherited inertia — ROI is rounded to 2dp *before* ranking, and
    // the sort is stable, so rounded ties keep insertion order. A SQL
    // `GROUP BY ... ORDER BY roi DESC` would rank on the unrounded value and
    // could order ties differently from what the read model has always returned.
    const rows = await this.repo.find();

    const agg = new Map<
      string,
      { name: string | null; stake: number; profit: number; count: number }
    >();
    for (const row of rows) {
      const entry = agg.get(row.userId) ?? {
        name: row.userName,
        stake: 0,
        profit: 0,
        count: 0,
      };
      entry.stake += row.stakeCents;
      entry.profit += row.profitCents;
      entry.count += 1;
      entry.name ??= row.userName;
      agg.set(row.userId, entry);
    }

    return [...agg.entries()]
      .filter(([, a]) => a.count >= minSettled)
      .map(([userId, a]) => ({
        userId,
        userName: a.name,
        roiPct: a.stake > 0 ? round2((a.profit / a.stake) * 100) : 0,
        netProfitCents: a.profit,
        settledCount: a.count,
      }))
      .sort((a, b) => b.roiPct - a.roiPct)
      .slice(0, limit);
  }
}
