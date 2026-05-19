import logging
import os
import time
from typing import AsyncIterator, ClassVar

import aiohttp

from models import OddsEvent
from .base import OddsProvider

logger = logging.getLogger(__name__)

DEFAULT_SPORTS = ["soccer_epl", "basketball_nba", "americanfootball_nfl"]


def _normalise(raw_event: dict, sport: str) -> OddsEvent | None:
    try:
        bookmakers = raw_event.get("bookmakers", [])
        if not bookmakers:
            return None
        market = next(
            (m for m in bookmakers[0].get("markets", []) if m["key"] == "h2h"),
            None,
        )
        if not market:
            return None

        outcomes = {o["name"]: o["price"] for o in market["outcomes"]}
        home = raw_event["home_team"]
        away = raw_event["away_team"]
        return OddsEvent(
            event_id=raw_event["id"],
            sport=sport,
            home_team=home,
            away_team=away,
            home_odds=outcomes.get(home, 0.0),
            away_odds=outcomes.get(away, 0.0),
            draw_odds=outcomes.get("Draw", 0.0),
            updated_at=int(time.time() * 1000),
        )
    except (KeyError, StopIteration):
        return None


class TheOddsApiProvider(OddsProvider):
    name: ClassVar[str] = "theoddsapi"

    def __init__(self, api_key: str, sports: list[str]):
        self._api_key = api_key
        self._sports = sports
        self._session: aiohttp.ClientSession | None = None

    @classmethod
    def from_env(cls) -> "TheOddsApiProvider":
        api_key = os.environ.get("THE_ODDS_API_KEY", "demo")
        sports_env = os.environ.get("THE_ODDS_API_SPORTS")
        sports = [s.strip() for s in sports_env.split(",")] if sports_env else DEFAULT_SPORTS
        return cls(api_key=api_key, sports=sports)

    async def __aenter__(self) -> "TheOddsApiProvider":
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def fetch_tick(self) -> AsyncIterator[OddsEvent]:
        assert self._session is not None, "fetch_tick called outside async-with"
        for sport in self._sports:
            url = (
                f"https://api.the-odds-api.com/v4/sports/{sport}/odds/"
                f"?apiKey={self._api_key}&regions=eu&markets=h2h&oddsFormat=decimal"
            )
            try:
                async with self._session.get(
                    url, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status != 200:
                        logger.warning("Odds API returned %s for %s", resp.status, sport)
                        continue
                    events = await resp.json()
                    for raw in events:
                        event = _normalise(raw, sport)
                        if event:
                            yield event
                logger.info("Polled %d events for %s", len(events), sport)
            except Exception as exc:
                logger.error("Poll failed for %s: %s", sport, exc)
