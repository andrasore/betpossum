"""RabbitMQ subscriber — relays NotificationEvent messages to socket.io clients."""

import logging

import aio_pika
import socketio  # pyright: ignore[reportMissingTypeStubs]

from generated.events import NotificationEvent

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "notifications"

# Maps NotificationEvent.kind → the socket.io event name the frontend listens
# on. The frontend validates the JSON payload with the matching generated Zod
# schema.
SOCKET_EVENT = {
    "oddsUpdated": "odds.updated",
    "betHeld": "bet.held",
    "betSettled": "bet.settled",
    "balanceUpdated": "balance.updated",
    "insufficientBalance": "insufficient.balance",
}


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
                event = NotificationEvent.model_validate_json(message.body)
                socket_event = SOCKET_EVENT[event.kind]
                if event.userId:
                    await sio.emit(socket_event, event.payload, to=event.userId)  # pyright: ignore[reportUnknownMemberType]
                else:
                    await sio.emit(socket_event, event.payload)  # pyright: ignore[reportUnknownMemberType]
            except Exception as exc:
                logger.error("Failed to handle notification: %s", exc)
