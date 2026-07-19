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

    # Source-side identity hints the storage entity resolver (`storage.postgres`)
    # uses to link this event to canonical sport/league/team rows. Providers
    # populate what they expose; absent ones fall back to name-based matching.
    # These are not persisted on the event row itself.
    sport_group: str | None = None
    league_key: str | None = None
    league_name: str | None = None
    country: str | None = None
    home_team_key: str | None = None
    away_team_key: str | None = None

    # Canonical display names, populated on the read path (GET /odds/events) by joining
    # the linked sport/league/team rows. None when an entity link is unresolved;
    # callers fall back to the raw `sport`/`home_team`/`away_team`. `league_name`
    # above doubles as the canonical league name on reads. Not persisted here.
    sport_title: str | None = None
    # Canonical league id (the `league` row this event links to), populated on
    # the read path; None when the league link is unresolved. Not persisted on
    # the event row itself — `league_id` lives on `odds_current`.
    league_id: int | None = None
    home_team_name: str | None = None
    away_team_name: str | None = None

    def market(self, key: str) -> Market | None:
        return next((m for m in self.markets if m.key == key), None)


class CanonicalSport(BaseModel):
    """A canonical sport: its stable slug and human-readable title.

    `slug` is what GET /odds/events filters on (`?sport=<slug>`, matched against
    `odds_current.sport_slug`); `title` is the display label.
    """

    slug: str
    title: str


class CanonicalLeague(BaseModel):
    """A canonical league: its stable id, name, and the sport it belongs to.

    `id` is what GET /odds/events filters on (`?league=<id>`, matched against
    `odds_current.league_id`); `name` is the display label. `sport_slug` ties
    the league to its parent sport (a league belongs to exactly one sport).
    """

    id: int
    name: str
    sport_slug: str


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
