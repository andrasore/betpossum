"""API-Football (api-sports.io v3) provider.

Demonstrates the flexible common model against a real API with rich bet types.
Team names + kickoff come from the `/fixtures` endpoint and odds from `/odds`;
the two are joined on the fixture id. The "Match Winner" bet maps to our `h2h`
market (and so projects onto the wire contract); "Goals Over/Under" maps to a
`totals` market that is stored but not emitted.

Results are discovered by polling `/fixtures` for the events the runner reports as
still open (`fetch_results`), so a concluded fixture settles without admin action.
Manual resolution stays restricted to the mock provider.
"""

import logging
import os
import time
from types import TracebackType
from typing import Any, AsyncIterator, ClassVar

import httpx

from odds.models import CanonicalEvent, EventResult, Market, Outcome, Selection
from .base import OddsProvider
from .common import outcome_for

logger = logging.getLogger(__name__)

BASE_URL = "https://v3.football.api-sports.io"
MATCH_WINNER = "Match Winner"
GOALS_OVER_UNDER = "Goals Over/Under"

# Fixture `status.short` codes that mean the match is over and has a winner (or
# a draw): full time, after extra time, after penalties.
FINAL_STATUSES = frozenset({"FT", "AET", "PEN"})
# ...and the ones that end a fixture with no fair 1X2 outcome. Bets on these stay
# held: guessing an outcome would settle real money on a match that never
# produced one, and the market has no void/refund concept.
NO_RESULT_STATUSES = frozenset({"PST", "CANC", "ABD", "AWD", "WO"})
# `/fixtures?ids=` accepts at most 20 dash-joined ids per request.
IDS_PER_REQUEST = 20


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


def _outcome_from_fixture(fixture: dict[str, Any]) -> Outcome | None:
    """Map a concluded fixture to our (home/away/draw) selection key.

    Keyed on API-Football's own winner flags: True/False for a decided match, and
    null on *both* sides for a draw. Returns None when the flags are absent
    altogether — a malformed payload must not settle bets as a draw.

    For AET/PEN fixtures the flag names whoever advanced, so a match level at 90
    minutes and won on penalties resolves as home/away rather than draw. That is
    a deliberate divergence from the regulation-time 1X2 convention the ingested
    "Match Winner" prices are quoted against.
    """
    teams: dict[str, Any] = fixture.get("teams", {})
    home: dict[str, Any] = teams.get("home") or {}
    away: dict[str, Any] = teams.get("away") or {}
    if "winner" not in home or "winner" not in away:
        return None
    if home["winner"] is True:
        return "home"
    if away["winner"] is True:
        return "away"
    return "draw"


class ApiFootballProvider(OddsProvider):
    name: ClassVar[str] = "apifootball"
    polls_results: ClassVar[bool] = True

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
                {
                    "league": league,
                    "season": self._season,
                    "next": str(self._upcoming),
                },
            )
            for fx in fixtures:
                event = await self._fetch_fixture_odds(fx, sport)
                if event is not None:
                    yield event
            logger.info("Polled %d fixtures for league %s", len(fixtures), league)

    async def fetch_results(
        self, pending: list[CanonicalEvent]
    ) -> AsyncIterator[EventResult]:
        by_source_id = {e.source_event_id: e for e in pending}
        ids = list(by_source_id)
        for start in range(0, len(ids), IDS_PER_REQUEST):
            batch = ids[start : start + IDS_PER_REQUEST]
            fixtures = await self._get("/fixtures", {"ids": "-".join(batch)})
            for fx in fixtures:
                result = self._result_for(fx, by_source_id)
                if result is not None:
                    yield result

    def _result_for(
        self, fixture: dict[str, Any], pending: dict[str, CanonicalEvent]
    ) -> EventResult | None:
        meta: dict[str, Any] = fixture.get("fixture", {})
        source_id = str(meta.get("id", ""))
        event = pending.get(source_id)
        if event is None:
            return None
        status = str(meta.get("status", {}).get("short", ""))
        if status in NO_RESULT_STATUSES:
            logger.info(
                "Fixture %s ended %s with no 1X2 outcome — %s stays unresolved",
                source_id,
                status,
                event.event_id,
            )
            return None
        if status not in FINAL_STATUSES:
            return None
        outcome = _outcome_from_fixture(fixture)
        if outcome is None:
            logger.warning(
                "Fixture %s is %s but carries no winner flags — %s stays unresolved",
                source_id,
                status,
                event.event_id,
            )
            return None
        logger.info(
            "Fixture %s finished (%s) — resolving %s as %s",
            source_id,
            status,
            event.event_id,
            outcome,
        )
        return EventResult(
            event_id=event.event_id,
            sport=event.sport,
            outcome=outcome,
            resolved_at=int(time.time() * 1000),
        )

    async def _fetch_fixture_odds(
        self, fixture: dict[str, Any], sport: str
    ) -> CanonicalEvent | None:
        try:
            fixture_id = str(fixture["fixture"]["id"])
            home = fixture["teams"]["home"]["name"]
            away = fixture["teams"]["away"]["name"]
            ts = fixture["fixture"].get("timestamp")
            commence_time = int(ts) * 1000 if ts is not None else None
        except KeyError, TypeError:
            return None

        # API-Football carries stable numeric league/team ids and the league's
        # country in the fixture payload — feed them to the entity resolver.
        league: dict[str, Any] = fixture.get("league", {})
        league_id = league.get("id")
        home_id = fixture["teams"]["home"].get("id")
        away_id = fixture["teams"]["away"].get("id")

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
            sport_group="soccer",  # API-Football is the soccer product
            league_key=str(league_id) if league_id is not None else None,
            league_name=league.get("name"),
            country=league.get("country"),
            home_team_key=str(home_id) if home_id is not None else None,
            away_team_key=str(away_id) if away_id is not None else None,
        )
