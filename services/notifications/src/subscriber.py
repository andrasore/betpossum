"""RabbitMQ subscriber — relays NotificationEvent messages to socket.io clients."""

import json
import logging
from typing import Any

import aio_pika
import socketio  # pyright: ignore[reportMissingTypeStubs]

from generated.events_pb2 import NotificationEvent

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "notifications"


async def run(rabbitmq_url: str, sio: socketio.AsyncServer) -> None:
    connection = await aio_pika.connect_robust(rabbitmq_url)
    channel = await connection.channel()
    exchange = await channel.declare_exchange(
        EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=False
    )
    queue = await channel.declare_queue(
        "", exclusive=True, auto_delete=True, durable=False
    )
    await queue.bind(exchange)

    logger.info("Notifications subscriber ready")
    async with queue.iterator(no_ack=True) as messages:
        async for message in messages:
            try:
                event = NotificationEvent.FromString(message.body)
                payload: dict[str, Any] = (
                    json.loads(event.payload) if event.payload else {}
                )
                if event.user_id:
                    await sio.emit(event.event, payload, to=event.user_id)  # pyright: ignore[reportUnknownMemberType]
                else:
                    await sio.emit(event.event, payload)  # pyright: ignore[reportUnknownMemberType]
            except Exception as exc:
                logger.error("Failed to handle notification: %s", exc)
