"""Redis subscriber — relays NotificationEvent messages to socket.io clients."""
import json
import logging
from typing import Any, cast

import redis.asyncio as redis  # pyright: ignore[reportMissingTypeStubs]
import socketio  # pyright: ignore[reportMissingTypeStubs]

from generated.events_pb2 import NotificationEvent

logger = logging.getLogger(__name__)


async def run(redis_url: str, sio: socketio.AsyncServer) -> None:
    r = redis.from_url(redis_url)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    pubsub = r.pubsub()  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    await pubsub.subscribe("notifications")  # pyright: ignore[reportUnknownMemberType]

    logger.info("Notifications subscriber ready")
    async for raw in pubsub.listen():  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        message = cast(dict[str, Any], raw)
        if message["type"] != "message":
            continue
        try:
            event = NotificationEvent.FromString(cast(bytes, message["data"]))
            payload: dict[str, Any] = json.loads(event.payload) if event.payload else {}
            if event.user_id:
                await sio.emit(event.event, payload, to=event.user_id)  # pyright: ignore[reportUnknownMemberType]
            else:
                await sio.emit(event.event, payload)  # pyright: ignore[reportUnknownMemberType]
        except Exception as exc:
            logger.error("Failed to handle notification: %s", exc)
