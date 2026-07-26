import logging
import os
import time
from collections import defaultdict
from types import TracebackType
from typing import Any, AsyncIterator, ClassVar

import httpx

from odds.models import CanonicalEvent, EventResult, Market, Outcome, Selection
from .base import OddsProvider
from .common import outcome_for

logger = logging.getLogger(__name__)

BASE_URL = "https://api.the-odds-api.com/v4"
DEFAULT_SPORTS = ["soccer_epl", "basketball_nba", "americanfootball_nfl"]
# `/scores` only returns finished games when `daysFrom` is set, and the API caps
# it at 3 days. A game that kicked off longer ago than that never comes back, so
# it ages out of the runner's pending window unresolved — tighter than the
# runner's own 7-day lookback, and the reason to poll well inside that.
SCORES_DAYS_FROM = 3


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


def _outcome_from_scores(
    scores: list[dict[str, Any]], home: str, away: str
) -> Outcome | None:
    """Map a finished game's score array to our (home/away/draw) selection key.

    The Odds API reports scores per team name (`[{"name": …, "score": "113"}]`,
    the score a *string*) and offers no winner flag, so the outcome is simply the
    comparison. Returns None when either side is missing or unparseable — a
    malformed payload must not settle bets.
    """
    points: dict[str, int] = {}
    for entry in scores:
        side = outcome_for(str(entry.get("name", "")), home, away)
        if side != "home" and side != "away":
            continue
        try:
            points[side] = int(entry["score"])
        except KeyError, TypeError, ValueError:
            return None
    if "home" not in points or "away" not in points:
        return None
    if points["home"] > points["away"]:
        return "home"
    if points["away"] > points["home"]:
        return "away"
    return "draw"


def _result_for(
    raw_event: dict[str, Any], pending: dict[str, CanonicalEvent]
) -> EventResult | None:
    event = pending.get(str(raw_event.get("id", "")))
    if event is None:
        return None
    if not raw_event.get("completed"):
        return None
    # `scores` is null until kickoff; a completed game without one is malformed.
    scores: list[dict[str, Any]] | None = raw_event.get("scores")
    if not scores:
        logger.warning(
            "Game %s is completed but carries no scores — %s stays unresolved",
            event.source_event_id,
            event.event_id,
        )
        return None
    # Match on the payload's own team names rather than our stored ones, so the
    # comparison can't be thrown off by a name the provider has since changed.
    outcome = _outcome_from_scores(
        scores,
        str(raw_event.get("home_team", "")),
        str(raw_event.get("away_team", "")),
    )
    if outcome is None:
        logger.warning(
            "Game %s has unreadable scores %s — %s stays unresolved",
            event.source_event_id,
            scores,
            event.event_id,
        )
        return None
    logger.info(
        "Game %s completed — resolving %s as %s",
        event.source_event_id,
        event.event_id,
        outcome,
    )
    return EventResult(
        event_id=event.event_id,
        sport=event.sport,
        outcome=outcome,
        resolved_at=int(time.time() * 1000),
    )


class TheOddsApiProvider(OddsProvider):
    name: ClassVar[str] = "theoddsapi"
    polls_results: ClassVar[bool] = True

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
                f"{BASE_URL}/sports/{sport}/odds/"
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

    async def fetch_results(
        self, pending: list[CanonicalEvent]
    ) -> AsyncIterator[EventResult]:
        assert self._client is not None, "fetch_results called outside async-with"
        # `/scores` is per-sport, so group the pending events by the sport key
        # they were ingested under and ask each sport only about its own ids.
        by_sport: dict[str, dict[str, CanonicalEvent]] = defaultdict(dict)
        for event in pending:
            by_sport[event.sport][event.source_event_id] = event

        for sport, wanted in by_sport.items():
            url = (
                f"{BASE_URL}/sports/{sport}/scores/"
                f"?apiKey={self._api_key}&daysFrom={SCORES_DAYS_FROM}"
                f"&eventIds={','.join(wanted)}"
            )
            try:
                resp = await self._client.get(url)
                if resp.status_code != 200:
                    logger.warning(
                        "Odds API scores returned %s for %s", resp.status_code, sport
                    )
                    continue
                raw_events: list[dict[str, Any]] = resp.json()
                for raw in raw_events:
                    result = _result_for(raw, wanted)
                    if result is not None:
                        yield result
                logger.info(
                    "Polled scores for %d pending %s events", len(wanted), sport
                )
            except Exception as exc:
                logger.error("Scores poll failed for %s: %s", sport, exc)
