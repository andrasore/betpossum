"""Pure aggregation over settlement rows.

Kept free of any DB or framework imports so the cumulative-ROI maths can be unit
tested directly. All money is integer cents in, dollars (float) out on the
summary; the series carries percentages only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class SettlementRow:
    """One settled bet, as stored in the read model.

    ``profit_cents`` is signed: +profit on a win, -stake on a loss.
    """

    settled_at: int  # Unix ms
    stake_cents: int
    profit_cents: int


@dataclass(frozen=True)
class PnlPoint:
    date: str  # UTC day, YYYY-MM-DD
    roiPct: float


@dataclass(frozen=True)
class Summary:
    totalStaked: float
    settledCount: int
    wins: int
    winRatePct: float
    netProfit: float
    roiPct: float


def _utc_day(settled_at_ms: int) -> str:
    return datetime.fromtimestamp(settled_at_ms / 1000, tz=timezone.utc).strftime(
        "%Y-%m-%d"
    )


def cumulative_roi_series(rows: list[SettlementRow]) -> list[PnlPoint]:
    """Cumulative ROI% to date, one point per active UTC day.

    Each point is ``cumulative net profit / cumulative stake * 100`` using every
    settlement up to and including that day. Days with no settlement produce no
    point; because the value is cumulative, the line simply carries the prior
    value forward between active days.
    """
    by_day: dict[str, tuple[int, int]] = {}
    for r in rows:
        day = _utc_day(r.settled_at)
        stake, profit = by_day.get(day, (0, 0))
        by_day[day] = (stake + r.stake_cents, profit + r.profit_cents)

    cum_stake = 0
    cum_profit = 0
    series: list[PnlPoint] = []
    for day in sorted(by_day):
        day_stake, day_profit = by_day[day]
        cum_stake += day_stake
        cum_profit += day_profit
        roi = (cum_profit / cum_stake * 100) if cum_stake > 0 else 0.0
        series.append(PnlPoint(date=day, roiPct=round(roi, 2)))
    return series


def summarise(rows: list[SettlementRow]) -> Summary:
    total_stake = sum(r.stake_cents for r in rows)
    net = sum(r.profit_cents for r in rows)
    settled = len(rows)
    wins = sum(1 for r in rows if r.profit_cents > 0)
    return Summary(
        totalStaked=round(total_stake / 100, 2),
        settledCount=settled,
        wins=wins,
        winRatePct=round(wins / settled * 100, 2) if settled > 0 else 0.0,
        netProfit=round(net / 100, 2),
        roiPct=round(net / total_stake * 100, 2) if total_stake > 0 else 0.0,
    )
