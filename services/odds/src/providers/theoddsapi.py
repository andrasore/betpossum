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

DEFAULT_SPORTS = ["soccer_epl", "basketball_nba", "americanfootball_nfl"]


def _h2h_market(outcomes: list[dict[str, Any]], home: str, away: str) -> Market | None:
    selections: list[Selection] = []
    for o in outcomes:
        key = outcome_for(o["name"], home, away)
        if key is None:
            continue
        selections.append(Selection(key=key, name=o["name"], odds=float(o["price"])))
    if not selections:
        return None
    return Market(key="h2h", selections=selections)


def _totals_market(outcomes: list[dict[str, Any]]) -> Market | None:
    selections: list[Selection] = []
    for o in outcomes:
        key = o["name"].strip().lower()
        if key not in ("over", "under"):
            continue
        selections.append(
            Selection(
                key=key,
                name=o["name"],
                odds=float(o["price"]),
                point=float(o["point"]) if o.get("point") is not None else None,
            )
        )
    if not selections:
        return None
    return Market(key="totals", selections=selections)


def _normalise(raw_event: dict[str, Any], sport: str) -> CanonicalEvent | None:
    try:
        bookmakers: list[dict[str, Any]] = raw_event.get("bookmakers", [])
        if not bookmakers:
            return None
        home: str = raw_event["home_team"]
        away: str = raw_event["away_team"]
        # Take the first bookmaker's markets as representative.
        raw_markets: list[dict[str, Any]] = bookmakers[0].get("markets", [])
        markets: list[Market] = []
        for m in raw_markets:
            outcomes = m.get("outcomes", [])
            if m["key"] == "h2h":
                market = _h2h_market(outcomes, home, away)
            elif m["key"] == "totals":
                market = _totals_market(outcomes)
            else:
                market = None
            if market is not None:
                markets.append(market)
        if not markets:
            return None

        source_id: str = raw_event["id"]
        # The Odds API's `sport_key` conflates sport and competition
        # ("soccer_epl"); it stands in as the league source key, and
        # `sport_title` ("EPL") as the league name. There are no team or league
        # ids — the resolver matches teams by normalized name.
        return CanonicalEvent(
            event_id=f"theoddsapi:{source_id}",
            origin="theoddsapi",
            source_event_id=source_id,
            sport=sport,
            home_team=home,
            away_team=away,
            markets=markets,
            updated_at=int(time.time() * 1000),
            league_key=raw_event.get("sport_key", sport),
            league_name=raw_event.get("sport_title"),
        )
    except KeyError, ValueError:
        return None


class TheOddsApiProvider(OddsProvider):
    name: ClassVar[str] = "theoddsapi"

    def __init__(self, api_key: str, sports: list[str]):
        self._api_key = api_key
        self._sports = sports
        self._client: httpx.AsyncClient | None = None

    @classmethod
    def from_env(cls) -> "TheOddsApiProvider":
        api_key = os.environ.get("THE_ODDS_API_KEY", "demo")
        sports_env = os.environ.get("THE_ODDS_API_SPORTS")
        sports = (
            [s.strip() for s in sports_env.split(",")] if sports_env else DEFAULT_SPORTS
        )
        return cls(api_key=api_key, sports=sports)

    async def __aenter__(self) -> "TheOddsApiProvider":
        self._client = httpx.AsyncClient(timeout=10)
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

    async def fetch_tick(self) -> AsyncIterator[CanonicalEvent]:
        assert self._client is not None, "fetch_tick called outside async-with"
        for sport in self._sports:
            url = (
                f"https://api.the-odds-api.com/v4/sports/{sport}/odds/"
                f"?apiKey={self._api_key}&regions=eu&markets=h2h,totals"
                f"&oddsFormat=decimal"
            )
            try:
                resp = await self._client.get(url)
                if resp.status_code != 200:
                    logger.warning(
                        "Odds API returned %s for %s", resp.status_code, sport
                    )
                    continue
                events: list[dict[str, Any]] = resp.json()
                for raw in events:
                    event = _normalise(raw, sport)
                    if event:
                        yield event
                logger.info("Polled %d events for %s", len(events), sport)
            except Exception as exc:
                logger.error("Poll failed for %s: %s", sport, exc)
