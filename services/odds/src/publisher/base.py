import aio_pika

from odds.models import EventResult, OddsEvent
from generated.events import (
    EventResolvedEvent,
    NotificationEvent,
    OddsUpdatedEvent,
)

ODDS_EXCHANGE = "odds.updated"
RESULTS_EXCHANGE = "events.resolved"
NOTIFICATIONS_EXCHANGE = "notifications"


class OddsPublisher:
    def __init__(self, rabbitmq_url: str):
        self._url = rabbitmq_url
        self._connection: aio_pika.abc.AbstractRobustConnection | None = None
        self._odds_exchange: aio_pika.abc.AbstractExchange | None = None
        self._results_exchange: aio_pika.abc.AbstractExchange | None = None
        self._notifications_exchange: aio_pika.abc.AbstractExchange | None = None

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

    async def _ensure_notifications_exchange(self) -> aio_pika.abc.AbstractExchange:
        if self._notifications_exchange is None:
            channel = await self._ensure_channel()
            self._notifications_exchange = await channel.declare_exchange(
                NOTIFICATIONS_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=False
            )
        return self._notifications_exchange

    async def publish(self, event: OddsEvent) -> None:
        odds_updated = OddsUpdatedEvent(
            eventId=event.event_id,
            sport=event.sport,
            homeTeam=event.home_team,
            awayTeam=event.away_team,
            homeOdds=event.home_odds,
            awayOdds=event.away_odds,
            drawOdds=event.draw_odds,
            updatedAt=event.updated_at,
        )

        odds_exchange = await self._ensure_odds_exchange()
        await odds_exchange.publish(
            aio_pika.Message(body=odds_updated.model_dump_json().encode()),
            routing_key="",
        )

        notifications_exchange = await self._ensure_notifications_exchange()
        notification = NotificationEvent(
            userId="", kind="oddsUpdated", payload=odds_updated.model_dump()
        )
        await notifications_exchange.publish(
            aio_pika.Message(body=notification.model_dump_json().encode()),
            routing_key="",
        )

    async def publish_result(self, result: EventResult) -> None:
        exchange = await self._ensure_results_exchange()
        payload = (
            EventResolvedEvent(
                eventId=result.event_id,
                sport=result.sport,
                outcome=result.outcome,
                resolvedAt=result.resolved_at,
            )
            .model_dump_json()
            .encode()
        )
        await exchange.publish(
            aio_pika.Message(
                body=payload, delivery_mode=aio_pika.DeliveryMode.PERSISTENT
            ),
            routing_key="",
        )

    async def close(self) -> None:
        if self._connection is not None:
            await self._connection.close()
            self._connection = None
            self._odds_exchange = None
            self._results_exchange = None
            self._notifications_exchange = None
