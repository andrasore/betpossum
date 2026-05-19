"""Redis subscriber — relays NotificationEvent messages to socket.io clients."""
import json
import logging
from typing import Any, cast

import redis  # pyright: ignore[reportMissingTypeStubs]
from flask_socketio import SocketIO  # pyright: ignore[reportMissingTypeStubs]

from generated.events_pb2 import NotificationEvent

logger = logging.getLogger(__name__)


def run(redis_url: str, socketio: SocketIO) -> None:
    r = redis.from_url(redis_url)
    pubsub = r.pubsub()  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    pubsub.subscribe("notifications")  # pyright: ignore[reportUnknownMemberType]

    logger.info("Notifications subscriber ready")
    for raw in pubsub.listen():  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        message = cast(dict[str, Any], raw)
        if message["type"] != "message":
            continue
        try:
            event = NotificationEvent.FromString(message["data"])
            payload: dict[str, Any] = json.loads(event.payload) if event.payload else {}
            if event.user_id:
                socketio.emit(event.event, payload, to=event.user_id)  # pyright: ignore[reportUnknownMemberType]
            else:
                socketio.emit(event.event, payload)  # pyright: ignore[reportUnknownMemberType]
        except Exception as exc:
            logger.error("Failed to handle notification: %s", exc)
