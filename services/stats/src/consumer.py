"""Durable consumer for the bets.settled domain event.

Mirrors Core's `events.resolved` durability: a durable fanout exchange and a
named durable queue with manual ack, so settlements survive a stats-service
outage instead of being dropped (unlike the fire-and-forget `notifications`
exchange). Idempotency comes from the ON CONFLICT upsert keyed on bet_id.
"""

import logging

import aio_pika

from db import StatsStore
from generated.events import BetSettledEvent

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "bets.settled"
QUEUE_NAME = "stats.bets.settled"


def _signed_profit_cents(event: BetSettledEvent) -> int:
    """+profit on a win, -stake on a loss (so a sum is net P&L)."""
    if event.won:
        return round(event.payout * 100)
    return -round(event.stake * 100)


async def handle(store: StatsStore, body: bytes) -> None:
    event = BetSettledEvent.model_validate_json(body)
    await store.record_settlement(
        bet_id=event.betId,
        user_id=event.userId,
        user_name=event.userName,
        settled_at=event.settledAt,
        stake_cents=round(event.stake * 100),
        profit_cents=_signed_profit_cents(event),
    )


async def run(rabbitmq_url: str, store: StatsStore) -> None:
    connection = await aio_pika.connect_robust(rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=16)
    exchange = await channel.declare_exchange(
        EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True
    )
    queue = await channel.declare_queue(QUEUE_NAME, durable=True)
    await queue.bind(exchange)

    logger.info("Stats consumer ready")
    async with queue.iterator() as messages:
        async for message in messages:
            try:
                await handle(store, message.body)
                await message.ack()
            except Exception:
                logger.exception("Failed to handle bets.settled; requeuing")
                await message.nack(requeue=True)
