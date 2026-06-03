from typing import Literal

from pydantic import BaseModel

Outcome = Literal["home", "away", "draw"]

# Market keys we know how to model. New bet types extend this union; only `h2h`
# projects onto the (home/away/draw) wire contract — see `h2h_odds`.
MarketKey = Literal["h2h", "totals", "spreads"]

H2H: MarketKey = "h2h"  # Head to head
TOTALS: MarketKey = "totals"
SPREADS: MarketKey = "spreads"


class Selection(BaseModel):
    """One outcome within a market, with its decimal odds.

    `key` is stable within the market (`home`/`away`/`draw` for h2h,
    `over`/`under` for totals, …); `point` carries the line for spread/total
    markets and is None for h2h.
    """

    key: str
    name: str
    odds: float
    point: float | None = None


class Market(BaseModel):
    key: MarketKey
    selections: list[Selection]


class CanonicalEvent(BaseModel):
    """Provider-agnostic representation of a sports event and its markets.

    `event_id` is our canonical id (`f"{origin}:{source_event_id}"`); `origin`
    is the provider that produced it; the `event_source_map` table records the
    link back to the provider's original ids.
    """

    event_id: str
    origin: str
    source_event_id: str
    sport: str
    home_team: str
    away_team: str
    commence_time: int | None = None  # Unix ms
    markets: list[Market]
    updated_at: int  # Unix ms
    outcome: Outcome | None = None
    resolved_at: int | None = None  # Unix ms

    def market(self, key: str) -> Market | None:
        return next((m for m in self.markets if m.key == key), None)


class EventResult(BaseModel):
    event_id: str
    sport: str
    outcome: Outcome
    resolved_at: int  # Unix ms


def h2h_odds(event: CanonicalEvent) -> tuple[float, float, float] | None:
    """Project the h2h market to (home, away, draw) decimal odds.

    Returns None when the event carries no h2h market — callers then skip the
    (home/away/draw) wire publish but still persist the flexible model.
    """
    market = event.market(H2H)
    if market is None:
        return None
    by_key = {s.key: s.odds for s in market.selections}
    if "home" not in by_key or "away" not in by_key:
        return None
    return (by_key["home"], by_key["away"], by_key.get("draw", 0.0))
