import asyncio
import logging
import time
import aiohttp
from models import OddsEvent
from publisher import OddsPublisher

logger = logging.getLogger(__name__)

SPORTS = ["soccer_epl", "basketball_nba", "americanfootball_nfl"]


def _normalise(raw_event: dict, sport: str) -> OddsEvent | None:
    """Map The Odds API response shape to our internal OddsEvent."""
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


async def poll_once(
    session: aiohttp.ClientSession,
    api_key: str,
    publisher: OddsPublisher,
) -> None:
    for sport in SPORTS:
        url = (
            f"https://api.the-odds-api.com/v4/sports/{sport}/odds/"
            f"?apiKey={api_key}&regions=eu&markets=h2h&oddsFormat=decimal"
        )
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    logger.warning("Odds API returned %s for %s", resp.status, sport)
                    continue
                events = await resp.json()
                for raw in events:
                    event = _normalise(raw, sport)
                    if event:
                        await publisher.publish(event)
            logger.info("Polled %d events for %s", len(events), sport)
        except Exception as exc:
            logger.error("Poll failed for %s: %s", sport, exc)


async def run_poller(api_key: str, redis_url: str, interval: int) -> None:
    publisher = OddsPublisher(redis_url)
    async with aiohttp.ClientSession() as session:
        while True:
            await poll_once(session, api_key, publisher)
            await asyncio.sleep(interval)
