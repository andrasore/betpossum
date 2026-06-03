import logging

import aio_pika

from odds.models import CanonicalEvent, EventResult, h2h_odds
from generated.events import (
    EventResolvedEvent,
    NotificationEvent,
    OddsUpdatedEvent,
)

logger = logging.getLogger(__name__)

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

    async def publish(self, event: CanonicalEvent) -> None:
        # The wire contract is 3-way (home/away/draw); project the h2h market
        # onto it. Events without an h2h market are persisted but not emitted.
        projected = h2h_odds(event)
        if projected is None:
            logger.info("Skipping wire publish for %s (no h2h market)", event.event_id)
            return
        home_odds, away_odds, draw_odds = projected
        # The wire event is a delta: just the changing odds, keyed by event id.
        # Static identity and canonical names ride the GET /odds hydrate; the
        # frontend merges this tick onto the already-hydrated event.
        odds_updated = OddsUpdatedEvent(
            eventId=event.event_id,
            homeOdds=home_odds,
            awayOdds=away_odds,
            drawOdds=draw_odds,
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
