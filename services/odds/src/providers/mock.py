"""Mock odds provider for local development.

Maintains a fixed pool of fixtures across three sports and slowly drifts their
odds on each tick so the frontend sees realistic live-market movement without
calling a real API. Each fixture carries a moneyline (`h2h`) market plus an
over/under (`totals`) market, so the flexible common model is exercised even
though only `h2h` projects onto the wire contract. Mock events are the only
ones an admin may resolve manually.
"""

import logging
import os
import random
import time
from typing import AsyncIterator, ClassVar, TypedDict

from odds.models import CanonicalEvent, EventResult, Market, Selection
from .base import OddsProvider

logger = logging.getLogger(__name__)


class Fixture(TypedDict):
    event_id: str
    sport: str
    home_team: str
    away_team: str


FIXTURES: list[Fixture] = [
    {
        "event_id": "epl-001",
        "sport": "soccer_epl",
        "home_team": "Arsenal",
        "away_team": "Chelsea",
    },
    {
        "event_id": "epl-002",
        "sport": "soccer_epl",
        "home_team": "Liverpool",
        "away_team": "Manchester City",
    },
    {
        "event_id": "epl-003",
        "sport": "soccer_epl",
        "home_team": "Tottenham",
        "away_team": "Manchester United",
    },
    {
        "event_id": "nba-001",
        "sport": "basketball_nba",
        "home_team": "LA Lakers",
        "away_team": "Golden State Warriors",
    },
    {
        "event_id": "nba-002",
        "sport": "basketball_nba",
        "home_team": "Boston Celtics",
        "away_team": "Miami Heat",
    },
    {
        "event_id": "nfl-001",
        "sport": "americanfootball_nfl",
        "home_team": "Kansas City Chiefs",
        "away_team": "San Francisco 49ers",
    },
    {
        "event_id": "nfl-002",
        "sport": "americanfootball_nfl",
        "home_team": "Dallas Cowboys",
        "away_team": "New York Giants",
    },
]

DEFAULT_RESOLVE_TICKS = 3

# Total-line per sport for the over/under market.
TOTAL_POINTS = {
    "soccer_epl": 2.5,
    "basketball_nba": 220.5,
    "americanfootball_nfl": 47.5,
}
DEFAULT_TOTAL_POINT = 2.5


def _has_draw(sport: str) -> bool:
    return sport.startswith("soccer")


def _seed(has_draw: bool) -> dict[str, float]:
    return {
        "home": round(random.uniform(1.5, 3.5), 2),
        "away": round(random.uniform(1.5, 3.5), 2),
        "draw": round(random.uniform(2.8, 4.0), 2) if has_draw else 0.0,
        "over": round(random.uniform(1.7, 2.1), 2),
        "under": round(random.uniform(1.7, 2.1), 2),
    }


def _drift(value: float, lo: float, hi: float) -> float:
    return round(max(lo, min(hi, value + random.uniform(-0.15, 0.15))), 2)


class MockProvider(OddsProvider):
    name: ClassVar[str] = "mock"

    def __init__(
        self,
        fixtures: list[Fixture] = FIXTURES,
        resolve_ticks: int = DEFAULT_RESOLVE_TICKS,
    ):
        self._fixtures = fixtures
        self._resolve_ticks = resolve_ticks
        self._state: dict[str, dict[str, float]] = {}
        self._ticks: dict[str, int] = {}
        self._resolved: set[str] = set()
        self._pending_results: list[EventResult] = []

    @classmethod
    def from_env(cls) -> "MockProvider":
        resolve_ticks = int(
            os.environ.get("MOCK_RESOLVE_TICKS", str(DEFAULT_RESOLVE_TICKS))
        )
        return cls(resolve_ticks=resolve_ticks)

    def _markets(self, sport: str, state: dict[str, float]) -> list[Market]:
        has_draw = _has_draw(sport)
        h2h = [
            Selection(key="home", name="Home", odds=state["home"]),
            Selection(key="away", name="Away", odds=state["away"]),
        ]
        if has_draw:
            h2h.insert(1, Selection(key="draw", name="Draw", odds=state["draw"]))
        point = TOTAL_POINTS.get(sport, DEFAULT_TOTAL_POINT)
        totals = [
            Selection(
                key="over", name=f"Over {point}", odds=state["over"], point=point
            ),
            Selection(
                key="under", name=f"Under {point}", odds=state["under"], point=point
            ),
        ]
        return [
            Market(key="h2h", selections=h2h),
            Market(key="totals", selections=totals),
        ]

    async def fetch_tick(self) -> AsyncIterator[CanonicalEvent]:
        for fixture in self._fixtures:
            sid = fixture["event_id"]
            if sid in self._resolved:
                continue
            has_draw = _has_draw(fixture["sport"])

            if sid not in self._state:
                self._state[sid] = _seed(has_draw)
                self._ticks[sid] = 0

            s = self._state[sid]
            s["home"] = _drift(s["home"], 1.1, 6.0)
            s["away"] = _drift(s["away"], 1.1, 6.0)
            if has_draw:
                s["draw"] = _drift(s["draw"], 2.5, 6.0)
            s["over"] = _drift(s["over"], 1.4, 2.6)
            s["under"] = _drift(s["under"], 1.4, 2.6)
            self._ticks[sid] += 1

            yield CanonicalEvent(
                event_id=self.canonical_id(sid),
                origin=self.name,
                source_event_id=sid,
                sport=fixture["sport"],
                home_team=fixture["home_team"],
                away_team=fixture["away_team"],
                markets=self._markets(fixture["sport"], s),
                updated_at=int(time.time() * 1000),
            )

        active = sum(1 for f in self._fixtures if f["event_id"] not in self._resolved)
        logger.info(
            "Published mock odds for %d active fixtures (%d resolved)",
            active,
            len(self._resolved),
        )

    async def fetch_results(self) -> AsyncIterator[EventResult]:
        while self._pending_results:
            yield self._pending_results.pop(0)
