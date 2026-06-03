"""API-Football (api-sports.io v3) provider.

Demonstrates the flexible common model against a real API with rich bet types.
Team names + kickoff come from the `/fixtures` endpoint and odds from `/odds`;
the two are joined on the fixture id. The "Match Winner" bet maps to our `h2h`
market (and so projects onto the wire contract); "Goals Over/Under" maps to a
`totals` market that is stored but not emitted. API-Football events are never
auto-resolved — manual resolution is restricted to the mock provider.
"""

import logging
import os
import time
from types import TracebackType
from typing import Any, AsyncIterator, ClassVar

import httpx

from odds.models import CanonicalEvent, Market, Selection
from .base import OddsProvider
from .common import outcome_for

logger = logging.getLogger(__name__)

BASE_URL = "https://v3.football.api-sports.io"
MATCH_WINNER = "Match Winner"
GOALS_OVER_UNDER = "Goals Over/Under"


def _totals_selection(value: str, odd: str) -> Selection | None:
    # value looks like "Over 2.5" / "Under 2.5"
    parts = value.split()
    if len(parts) != 2:
        return None
    side = parts[0].strip().lower()
    if side not in ("over", "under"):
        return None
    try:
        point = float(parts[1])
    except ValueError:
        return None
    return Selection(key=side, name=value, odds=float(odd), point=point)


def _markets_from_bets(
    bets: list[dict[str, Any]], home: str, away: str
) -> list[Market]:
    markets: list[Market] = []
    for bet in bets:
        name = bet.get("name")
        values: list[dict[str, Any]] = bet.get("values", [])
        if name == MATCH_WINNER:
            selections: list[Selection] = []
            for v in values:
                key = outcome_for(str(v["value"]), home, away)
                if key is None:
                    continue
                selections.append(
                    Selection(key=key, name=str(v["value"]), odds=float(v["odd"]))
                )
            if selections:
                markets.append(Market(key="h2h", selections=selections))
        elif name == GOALS_OVER_UNDER:
            totals = [
                s
                for v in values
                if (s := _totals_selection(str(v["value"]), str(v["odd"]))) is not None
            ]
            if totals:
                markets.append(Market(key="totals", selections=totals))
    return markets


class ApiFootballProvider(OddsProvider):
    name: ClassVar[str] = "apifootball"

    def __init__(self, api_key: str, leagues: list[str], season: str, upcoming: int):
        self._api_key = api_key
        self._leagues = leagues
        self._season = season
        self._upcoming = upcoming
        self._client: httpx.AsyncClient | None = None

    @classmethod
    def from_env(cls) -> "ApiFootballProvider":
        api_key = os.environ.get("APIFOOTBALL_API_KEY")
        if not api_key:
            raise RuntimeError(
                "APIFOOTBALL_API_KEY is required when 'apifootball' is enabled"
            )
        leagues_env = os.environ.get("APIFOOTBALL_LEAGUES", "39")  # 39 = EPL
        leagues = [s.strip() for s in leagues_env.split(",") if s.strip()]
        season = os.environ.get("APIFOOTBALL_SEASON", "2023")
        upcoming = int(os.environ.get("APIFOOTBALL_UPCOMING", "5"))
        return cls(api_key=api_key, leagues=leagues, season=season, upcoming=upcoming)

    async def __aenter__(self) -> "ApiFootballProvider":
        self._client = httpx.AsyncClient(
            headers={"x-apisports-key": self._api_key}, timeout=10
        )
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        assert self._client is not None, "_get called outside async-with"
        resp = await self._client.get(f"{BASE_URL}{path}", params=params)
        if resp.status_code != 200:
            logger.warning("API-Football %s returned %s", path, resp.status_code)
            return []
        body: dict[str, Any] = resp.json()
        return body.get("response", [])

    async def fetch_tick(self) -> AsyncIterator[CanonicalEvent]:
        for league in self._leagues:
            sport = f"soccer_{league}"
            fixtures = await self._get(
                "/fixtures",
                {"league": league, "season": self._season, "next": str(self._upcoming)},
            )
            for fx in fixtures:
                event = await self._fetch_fixture_odds(fx, sport)
                if event is not None:
                    yield event
            logger.info("Polled %d fixtures for league %s", len(fixtures), league)

    async def _fetch_fixture_odds(
        self, fixture: dict[str, Any], sport: str
    ) -> CanonicalEvent | None:
        try:
            fixture_id = str(fixture["fixture"]["id"])
            home = fixture["teams"]["home"]["name"]
            away = fixture["teams"]["away"]["name"]
            ts = fixture["fixture"].get("timestamp")
            commence_time = int(ts) * 1000 if ts is not None else None
        except (KeyError, TypeError):
            return None

        odds = await self._get("/odds", {"fixture": fixture_id})
        if not odds:
            return None
        bookmakers: list[dict[str, Any]] = odds[0].get("bookmakers", [])
        if not bookmakers:
            return None
        markets = _markets_from_bets(bookmakers[0].get("bets", []), home, away)
        if not markets:
            return None

        return CanonicalEvent(
            event_id=self.canonical_id(fixture_id),
            origin=self.name,
            source_event_id=fixture_id,
            sport=sport,
            home_team=home,
            away_team=away,
            commence_time=commence_time,
            markets=markets,
            updated_at=int(time.time() * 1000),
        )
