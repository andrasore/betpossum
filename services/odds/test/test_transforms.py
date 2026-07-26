"""Provider payload -> common-model transforms, result mapping, and the h2h wire
projection.

These exercise real boundaries: the shape each external API actually returns,
and the projection the wire contract depends on.
"""

from typing import Any

import pytest

from odds.models import CanonicalEvent, Market, Selection, h2h_odds
from providers.apifootball import (
    ApiFootballProvider,
    _markets_from_bets,
    _outcome_from_fixture,
)
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


# ── API-Football result mapping ──────────────────────────────────────────────
#
# Payload shapes copied from live `/fixtures?ids=` responses. `score.fulltime`
# is carried even though the mapping keys off the winner flags, so the PEN case
# documents which of the two the settlement follows.


def _fixture(
    status: str,
    *,
    home_winner: object,
    away_winner: object,
    fulltime: tuple[int, int] = (0, 0),
    penalty: tuple[int, int] | None = None,
    fixture_id: int = 1492300,
) -> dict[str, Any]:
    return {
        "fixture": {"id": fixture_id, "status": {"short": status}},
        "teams": {
            "home": {"name": "Atletico Paranaense", "winner": home_winner},
            "away": {"name": "Internacional", "winner": away_winner},
        },
        "goals": {"home": fulltime[0], "away": fulltime[1]},
        "score": {
            "fulltime": {"home": fulltime[0], "away": fulltime[1]},
            "penalty": (
                {"home": penalty[0], "away": penalty[1]}
                if penalty is not None
                else {"home": None, "away": None}
            ),
        },
    }


def _pending_event(source_id: str = "1492300") -> CanonicalEvent:
    return CanonicalEvent(
        event_id=f"apifootball:{source_id}",
        origin="apifootball",
        source_event_id=source_id,
        sport="soccer_71",
        home_team="Atletico Paranaense",
        away_team="Internacional",
        markets=[],
        updated_at=1,
    )


def _provider() -> ApiFootballProvider:
    return ApiFootballProvider(api_key="k", leagues=["71"], season="2026", upcoming=3)


@pytest.mark.parametrize(
    ("home_winner", "away_winner", "expected"),
    [
        (True, False, "home"),
        (False, True, "away"),
        # A 90-minute draw comes back with a null winner on *both* sides.
        (None, None, "draw"),
    ],
)
def test_outcome_from_winner_flags(
    home_winner: object, away_winner: object, expected: str
) -> None:
    fixture = _fixture("FT", home_winner=home_winner, away_winner=away_winner)
    assert _outcome_from_fixture(fixture) == expected


def test_outcome_none_when_winner_flags_absent() -> None:
    # A malformed payload must not settle bets as a draw.
    assert _outcome_from_fixture({"teams": {"home": {}, "away": {}}}) is None
    assert _outcome_from_fixture({}) is None


def test_result_for_finished_fixture_carries_canonical_id_and_sport() -> None:
    fixture = _fixture("FT", home_winner=True, away_winner=False, fulltime=(2, 0))
    result = _provider()._result_for(fixture, {"1492300": _pending_event()})

    assert result is not None
    assert result.event_id == "apifootball:1492300"
    assert result.sport == "soccer_71"
    assert result.outcome == "home"
    assert result.resolved_at > 0


def test_result_for_penalties_follows_the_advancing_team() -> None:
    # MLS playoff shape: level at 90, decided 6-7 on penalties. We settle on the
    # winner flag, so this is `away` rather than the regulation-time `draw`.
    fixture = _fixture(
        "PEN",
        home_winner=False,
        away_winner=True,
        fulltime=(0, 0),
        penalty=(6, 7),
    )
    result = _provider()._result_for(fixture, {"1492300": _pending_event()})

    assert result is not None
    assert result.outcome == "away"


@pytest.mark.parametrize("status", ["NS", "1H", "HT", "2H", "SUSP"])
def test_result_for_unfinished_fixture_is_none(status: str) -> None:
    fixture = _fixture(status, home_winner=None, away_winner=None)
    assert _provider()._result_for(fixture, {"1492300": _pending_event()}) is None


@pytest.mark.parametrize("status", ["PST", "CANC", "ABD"])
def test_result_for_abandoned_fixture_is_none(status: str) -> None:
    # No fair 1X2 outcome — the bet stays held rather than being guessed at.
    fixture = _fixture(status, home_winner=None, away_winner=None)
    assert _provider()._result_for(fixture, {"1492300": _pending_event()}) is None


def test_result_for_unrequested_fixture_is_none() -> None:
    # The batch only asks for pending ids, but never trust the echo.
    fixture = _fixture("FT", home_winner=True, away_winner=False, fixture_id=999)
    assert _provider()._result_for(fixture, {"1492300": _pending_event()}) is None
