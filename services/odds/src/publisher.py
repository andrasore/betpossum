import redis.asyncio as aioredis
from models import OddsEvent
from generated.events_pb2 import OddsUpdatedEvent


class OddsPublisher:
    def __init__(self, redis_url: str):
        self._redis = aioredis.from_url(redis_url, decode_responses=False)

    async def publish(self, event: OddsEvent) -> None:
        payload = OddsUpdatedEvent(
            event_id=event.event_id,
            sport=event.sport,
            home_team=event.home_team,
            away_team=event.away_team,
            home_odds=event.home_odds,
            away_odds=event.away_odds,
            draw_odds=event.draw_odds,
            updated_at=event.updated_at,
        ).SerializeToString()
        await self._redis.publish("odds.updated", payload)

    async def close(self) -> None:
        await self._redis.aclose()
