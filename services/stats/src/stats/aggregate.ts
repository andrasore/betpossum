/**
 * Pure aggregation over settlement rows.
 *
 * Kept free of any DB or framework imports so the cumulative-ROI maths can be
 * unit tested directly. All money is integer cents, in and out; only the
 * percentages (ROI, win rate) are floats.
 */
import { round2 } from "../common/round";

/** One settled bet, as stored in the read model. */
export interface SettlementRow {
  /** Unix ms. */
  settledAt: number;
  stakeCents: number;
  /** Signed: +profit on a win, -stake on a loss. */
  profitCents: number;
}

export interface PnlPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  roiPct: number;
}

export interface Summary {
  totalStakedCents: number;
  settledCount: number;
  wins: number;
  winRatePct: number;
  netProfitCents: number;
  roiPct: number;
}

function utcDay(settledAtMs: number): string {
  return new Date(settledAtMs).toISOString().slice(0, 10);
}

/**
 * Cumulative ROI% to date, one point per active UTC day.
 *
 * Each point is `cumulative net profit / cumulative stake * 100` using every
 * settlement up to and including that day. Days with no settlement produce no
 * point; because the value is cumulative, the line simply carries the prior
 * value forward between active days.
 */
export function cumulativeRoiSeries(rows: SettlementRow[]): PnlPoint[] {
  const byDay = new Map<string, { stake: number; profit: number }>();
  for (const row of rows) {
    const day = utcDay(row.settledAt);
    const acc = byDay.get(day) ?? { stake: 0, profit: 0 };
    acc.stake += row.stakeCents;
    acc.profit += row.profitCents;
    byDay.set(day, acc);
  }

  let cumStake = 0;
  let cumProfit = 0;
  const series: PnlPoint[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const acc = byDay.get(day) as { stake: number; profit: number };
    cumStake += acc.stake;
    cumProfit += acc.profit;
    const roi = cumStake > 0 ? (cumProfit / cumStake) * 100 : 0;
    series.push({ date: day, roiPct: round2(roi) });
  }
  return series;
}

export function summarise(rows: SettlementRow[]): Summary {
  const totalStake = rows.reduce((sum, r) => sum + r.stakeCents, 0);
  const net = rows.reduce((sum, r) => sum + r.profitCents, 0);
  const settled = rows.length;
  // A zero-profit settlement is not a win — matches the Python read model.
  const wins = rows.filter((r) => r.profitCents > 0).length;
  return {
    totalStakedCents: totalStake,
    settledCount: settled,
    wins,
    winRatePct: settled > 0 ? round2((wins / settled) * 100) : 0,
    netProfitCents: net,
    roiPct: totalStake > 0 ? round2((net / totalStake) * 100) : 0,
  };
}
