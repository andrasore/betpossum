"""Unit tests for the pure cumulative-ROI maths (no DB)."""

from datetime import datetime, timezone

from aggregate import SettlementRow, cumulative_roi_series, summarise


def _ms(day: str) -> int:
    return int(
        datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
        * 1000
    )


def test_cumulative_roi_buckets_by_utc_day_and_carries_forward() -> None:
    rows = [
        # Day 1: stake 100, win +50  -> cum 50/100 = 50%
        SettlementRow(_ms("2026-01-01"), 10_000, 5_000),
        # Day 1, second bet: stake 100, loss -100 -> cum -50/200 = -25%
        SettlementRow(_ms("2026-01-01") + 1, 10_000, -10_000),
        # Day 3 (gap on day 2): stake 200, win +200 -> cum 150/400 = 37.5%
        SettlementRow(_ms("2026-01-03"), 20_000, 20_000),
    ]
    series = cumulative_roi_series(rows)
    # One point per active day; day 2 produces nothing.
    assert [p.date for p in series] == ["2026-01-01", "2026-01-03"]
    assert series[0].roiPct == -25.0
    assert series[1].roiPct == 37.5


def test_cumulative_roi_all_losses_is_negative() -> None:
    rows = [
        SettlementRow(_ms("2026-02-01"), 10_000, -10_000),
        SettlementRow(_ms("2026-02-02"), 10_000, -10_000),
    ]
    series = cumulative_roi_series(rows)
    assert series[-1].roiPct == -100.0


def test_empty_series() -> None:
    assert cumulative_roi_series([]) == []


def test_summary_counts_wins_and_roi() -> None:
    rows = [
        SettlementRow(_ms("2026-03-01"), 10_000, 5_000),  # win
        SettlementRow(_ms("2026-03-01"), 10_000, -10_000),  # loss
        SettlementRow(_ms("2026-03-02"), 20_000, 10_000),  # win
    ]
    s = summarise(rows)
    assert s.settledCount == 3
    assert s.wins == 2
    assert s.winRatePct == round(2 / 3 * 100, 2)
    assert s.totalStaked == 400.0
    assert s.netProfit == 50.0
    assert s.roiPct == 12.5


def test_summary_empty_is_zeroed() -> None:
    s = summarise([])
    assert s.settledCount == 0
    assert s.winRatePct == 0.0
    assert s.roiPct == 0.0
