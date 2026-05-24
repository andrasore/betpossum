"""RabbitMQ subscriber — relays NotificationEvent messages to socket.io clients."""

import logging

import aio_pika
import socketio  # pyright: ignore[reportMissingTypeStubs]

from generated.events_pb2 import NotificationEvent

logger = logging.getLogger(__name__)

EXCHANGE_NAME = "notifications"

# Maps NotificationEvent.body oneof variant → the socket.io event name the
# frontend listens on. The frontend decodes the binary frame with the
# matching generated protobuf message type.
SOCKET_EVENT = {
    "odds_updated": "odds.updated",
    "bet_held": "bet.held",
    "bet_settled": "bet.settled",
    "balance_updated": "balance.updated",
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
                event = NotificationEvent.FromString(message.body)
                variant = event.WhichOneof("body")
                if variant is None:
                    logger.warning("Notification with empty body, skipping")
                    continue
                socket_event = SOCKET_EVENT[variant]
                body = getattr(event, variant).SerializeToString()
                if event.user_id:
                    await sio.emit(socket_event, body, to=event.user_id)  # pyright: ignore[reportUnknownMemberType]
                else:
                    await sio.emit(socket_event, body)  # pyright: ignore[reportUnknownMemberType]
            except Exception as exc:
                logger.error("Failed to handle notification: %s", exc)
