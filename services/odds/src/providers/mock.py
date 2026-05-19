"""Mock odds provider for local development.

Maintains a fixed pool of fixtures across three sports and slowly drifts
their odds on each tick so the frontend sees realistic live-market movement
without calling the real API.
"""
import logging
import random
import time
from typing import AsyncIterator, ClassVar, TypedDict

from models import OddsEvent
from .base import OddsProvider

logger = logging.getLogger(__name__)


class Fixture(TypedDict):
    event_id: str
    sport: str
    home_team: str
    away_team: str


FIXTURES: list[Fixture] = [
    {"event_id": "mock-epl-001", "sport": "soccer_epl",            "home_team": "Arsenal",               "away_team": "Chelsea"},
    {"event_id": "mock-epl-002", "sport": "soccer_epl",            "home_team": "Liverpool",              "away_team": "Manchester City"},
    {"event_id": "mock-epl-003", "sport": "soccer_epl",            "home_team": "Tottenham",              "away_team": "Manchester United"},
    {"event_id": "mock-nba-001", "sport": "basketball_nba",        "home_team": "LA Lakers",              "away_team": "Golden State Warriors"},
    {"event_id": "mock-nba-002", "sport": "basketball_nba",        "home_team": "Boston Celtics",         "away_team": "Miami Heat"},
    {"event_id": "mock-nfl-001", "sport": "americanfootball_nfl",  "home_team": "Kansas City Chiefs",     "away_team": "San Francisco 49ers"},
    {"event_id": "mock-nfl-002", "sport": "americanfootball_nfl",  "home_team": "Dallas Cowboys",         "away_team": "New York Giants"},
]


def _has_draw(sport: str) -> bool:
    return sport.startswith("soccer")


def _seed(has_draw: bool) -> dict[str, float]:
    return {
        "home": round(random.uniform(1.5, 3.5), 2),
        "away": round(random.uniform(1.5, 3.5), 2),
        "draw": round(random.uniform(2.8, 4.0), 2) if has_draw else 0.0,
    }


def _drift(value: float, lo: float, hi: float) -> float:
    return round(max(lo, min(hi, value + random.uniform(-0.15, 0.15))), 2)


class MockProvider(OddsProvider):
    name: ClassVar[str] = "mock"

    def __init__(self, fixtures: list[Fixture] = FIXTURES):
        self._fixtures = fixtures
        self._state: dict[str, dict[str, float]] = {}

    @classmethod
    def from_env(cls) -> "MockProvider":
        return cls()

    async def fetch_tick(self) -> AsyncIterator[OddsEvent]:
        for fixture in self._fixtures:
            eid = fixture["event_id"]
            has_draw = _has_draw(fixture["sport"])

            if eid not in self._state:
                self._state[eid] = _seed(has_draw)

            s = self._state[eid]
            s["home"] = _drift(s["home"], 1.1, 6.0)
            s["away"] = _drift(s["away"], 1.1, 6.0)
            if has_draw:
                s["draw"] = _drift(s["draw"], 2.5, 6.0)

            yield OddsEvent(
                event_id=eid,
                sport=fixture["sport"],
                home_team=fixture["home_team"],
                away_team=fixture["away_team"],
                home_odds=s["home"],
                away_odds=s["away"],
                draw_odds=s["draw"],
                updated_at=int(time.time() * 1000),
            )

        logger.info("Published mock odds for %d fixtures", len(self._fixtures))
