"""Provider payload -> common-model transforms and the h2h wire projection.

These exercise real boundaries: the shape each external API actually returns,
and the projection the wire contract depends on.
"""

from odds.models import CanonicalEvent, Market, Selection, h2h_odds
from providers.apifootball import _markets_from_bets
from providers.theoddsapi import _normalise


def _market(event: CanonicalEvent, key: str) -> Market:
    market = event.market(key)
    assert market is not None, f"missing {key} market"
    return market


def _odds_by_key(market: Market) -> dict[str, float]:
    return {s.key: s.odds for s in market.selections}


def test_theoddsapi_normalise_builds_h2h_and_totals() -> None:
    raw = {
        "id": "abc123",
        "home_team": "Arsenal",
        "away_team": "Chelsea",
        "bookmakers": [
            {
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [
                            {"name": "Arsenal", "price": 1.8},
                            {"name": "Chelsea", "price": 4.2},
                            {"name": "Draw", "price": 3.5},
                        ],
                    },
                    {
                        "key": "totals",
                        "outcomes": [
                            {"name": "Over", "price": 1.9, "point": 2.5},
                            {"name": "Under", "price": 1.95, "point": 2.5},
                        ],
                    },
                ]
            }
        ],
    }

    event = _normalise(raw, "soccer_epl")
    assert event is not None
    assert event.origin == "theoddsapi"
    assert event.event_id == "theoddsapi:abc123"
    assert event.source_event_id == "abc123"

    h2h = _odds_by_key(_market(event, "h2h"))
    assert h2h == {"home": 1.8, "away": 4.2, "draw": 3.5}

    totals = _market(event, "totals")
    over = next(s for s in totals.selections if s.key == "over")
    assert over.point == 2.5


def test_theoddsapi_normalise_skips_eventless_payload() -> None:
    assert _normalise({"id": "x", "home_team": "A", "away_team": "B"}, "s") is None


def test_apifootball_match_winner_maps_to_h2h() -> None:
    bets = [
        {
            "name": "Match Winner",
            "values": [
                {"value": "Home", "odd": "2.10"},
                {"value": "Draw", "odd": "3.40"},
                {"value": "Away", "odd": "3.20"},
            ],
        },
        {
            "name": "Goals Over/Under",
            "values": [
                {"value": "Over 2.5", "odd": "1.85"},
                {"value": "Under 2.5", "odd": "1.95"},
            ],
        },
    ]

    markets = _markets_from_bets(bets, "Arsenal", "Chelsea")
    by_key = {m.key: m for m in markets}

    assert _odds_by_key(by_key["h2h"]) == {"home": 2.10, "away": 3.20, "draw": 3.40}
    under = next(s for s in by_key["totals"].selections if s.key == "under")
    assert under.point == 2.5


def test_h2h_odds_projection() -> None:
    event = CanonicalEvent(
        event_id="mock:e1",
        origin="mock",
        source_event_id="e1",
        sport="soccer_epl",
        home_team="A",
        away_team="B",
        markets=[
            Market(
                key="h2h",
                selections=[
                    Selection(key="home", name="A", odds=1.5),
                    Selection(key="draw", name="Draw", odds=3.0),
                    Selection(key="away", name="B", odds=2.0),
                ],
            )
        ],
        updated_at=1,
    )
    assert h2h_odds(event) == (1.5, 2.0, 3.0)


def test_h2h_odds_none_without_h2h_market() -> None:
    event = CanonicalEvent(
        event_id="mock:e2",
        origin="mock",
        source_event_id="e2",
        sport="basketball_nba",
        home_team="A",
        away_team="B",
        markets=[
            Market(
                key="totals",
                selections=[Selection(key="over", name="Over", odds=1.9, point=210.5)],
            )
        ],
        updated_at=1,
    )
    assert h2h_odds(event) is None
