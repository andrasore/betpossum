import aio_pika

from models import EventResult, OddsEvent, Outcome
from generated.events_pb2 import EventResolvedEvent, OddsUpdatedEvent
from generated import events_pb2

ODDS_EXCHANGE = "odds.updated"
RESULTS_EXCHANGE = "events.resolved"

_OUTCOME_MAP: dict[Outcome, "events_pb2.Outcome.ValueType"] = {
    "home": events_pb2.OUTCOME_HOME,
    "away": events_pb2.OUTCOME_AWAY,
    "draw": events_pb2.OUTCOME_DRAW,
}


class OddsPublisher:
    def __init__(self, rabbitmq_url: str):
        self._url = rabbitmq_url
        self._connection: aio_pika.abc.AbstractRobustConnection | None = None
        self._odds_exchange: aio_pika.abc.AbstractExchange | None = None
        self._results_exchange: aio_pika.abc.AbstractExchange | None = None

    async def _ensure_channel(self) -> aio_pika.abc.AbstractChannel:
        if self._connection is None:
            self._connection = await aio_pika.connect_robust(self._url)
        return await self._connection.channel()

    async def _ensure_odds_exchange(self) -> aio_pika.abc.AbstractExchange:
        if self._odds_exchange is None:
            channel = await self._ensure_channel()
            self._odds_exchange = await channel.declare_exchange(
                ODDS_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=False
            )
        return self._odds_exchange

    async def _ensure_results_exchange(self) -> aio_pika.abc.AbstractExchange:
        if self._results_exchange is None:
            channel = await self._ensure_channel()
            self._results_exchange = await channel.declare_exchange(
                RESULTS_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True
            )
        return self._results_exchange

    async def publish(self, event: OddsEvent) -> None:
        exchange = await self._ensure_odds_exchange()
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
        await exchange.publish(aio_pika.Message(body=payload), routing_key="")

    async def publish_result(self, result: EventResult) -> None:
        exchange = await self._ensure_results_exchange()
        payload = EventResolvedEvent(
            event_id=result.event_id,
            sport=result.sport,
            outcome=_OUTCOME_MAP[result.outcome],
            resolved_at=result.resolved_at,
        ).SerializeToString()
        await exchange.publish(
            aio_pika.Message(body=payload, delivery_mode=aio_pika.DeliveryMode.PERSISTENT),
            routing_key="",
        )

    async def close(self) -> None:
        if self._connection is not None:
            await self._connection.close()
            self._connection = None
            self._odds_exchange = None
            self._results_exchange = None
