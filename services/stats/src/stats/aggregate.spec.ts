/** Unit tests for the pure cumulative-ROI maths (no DB). */
import { round2 } from "../common/round";
import {
  cumulativeRoiSeries,
  type SettlementRow,
  summarise,
} from "./aggregate";

const ms = (day: string): number => Date.parse(`${day}T00:00:00Z`);

const row = (
  settledAt: number,
  stakeCents: number,
  profitCents: number,
): SettlementRow => ({ settledAt, stakeCents, profitCents });

describe("cumulativeRoiSeries", () => {
  it("buckets by UTC day and carries forward across gaps", () => {
    const rows = [
      // Day 1: stake 100, win +50  -> cum 50/100 = 50%
      row(ms("2026-01-01"), 10_000, 5_000),
      // Day 1, second bet: stake 100, loss -100 -> cum -50/200 = -25%
      row(ms("2026-01-01") + 1, 10_000, -10_000),
      // Day 3 (gap on day 2): stake 200, win +200 -> cum 150/400 = 37.5%
      row(ms("2026-01-03"), 20_000, 20_000),
    ];

    const series = cumulativeRoiSeries(rows);

    // One point per active day; day 2 produces nothing.
    expect(series.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-03"]);
    expect(series[0].roiPct).toBe(-25);
    expect(series[1].roiPct).toBe(37.5);
  });

  it("is negative when every bet loses", () => {
    const series = cumulativeRoiSeries([
      row(ms("2026-02-01"), 10_000, -10_000),
      row(ms("2026-02-02"), 10_000, -10_000),
    ]);

    expect(series[series.length - 1].roiPct).toBe(-100);
  });

  it("returns nothing for no settlements", () => {
    expect(cumulativeRoiSeries([])).toEqual([]);
  });
});

describe("summarise", () => {
  it("counts wins and computes ROI", () => {
    const s = summarise([
      row(ms("2026-03-01"), 10_000, 5_000), // win
      row(ms("2026-03-01"), 10_000, -10_000), // loss
      row(ms("2026-03-02"), 20_000, 10_000), // win
    ]);

    expect(s.settledCount).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.winRatePct).toBe(round2((2 / 3) * 100));
    expect(s.totalStakedCents).toBe(40_000);
    expect(s.netProfitCents).toBe(5_000);
    expect(s.roiPct).toBe(12.5);
  });

  it("does not count a zero-profit settlement as a win", () => {
    const s = summarise([
      row(ms("2026-03-01"), 10_000, 0),
      row(ms("2026-03-01"), 10_000, 5_000),
    ]);

    expect(s.wins).toBe(1);
    expect(s.winRatePct).toBe(50);
  });

  it("is zeroed for no settlements", () => {
    const s = summarise([]);
    expect(s.settledCount).toBe(0);
    expect(s.winRatePct).toBe(0);
    expect(s.roiPct).toBe(0);
  });
});

describe("round2", () => {
  // The read model was built in Python, whose round() breaks ties to even.
  // Math.round would give 0.13 and -0.13 for the first two.
  it.each([
    [0.125, 0.12],
    [-0.125, -0.12],
    [2.675, 2.67],
    [12.345, 12.35],
    [33.333333333333336, 33.33],
  ])("rounds %p to %p", (input, expected) => {
    expect(round2(input)).toBe(expected);
  });
});
