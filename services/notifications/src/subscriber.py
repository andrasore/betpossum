"""Redis subscriber — relays NotificationEvent messages to socket.io clients."""
import json
import logging
import redis
from generated.events_pb2 import NotificationEvent

logger = logging.getLogger(__name__)


def run(redis_url: str, socketio) -> None:
    r = redis.from_url(redis_url)
    pubsub = r.pubsub()
    pubsub.subscribe("notifications")

    logger.info("Notifications subscriber ready")
    for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            event = NotificationEvent.FromString(message["data"])
            payload = json.loads(event.payload) if event.payload else {}
            if event.user_id:
                socketio.emit(event.event, payload, to=event.user_id)
            else:
                socketio.emit(event.event, payload)
        except Exception as exc:
            logger.error("Failed to handle notification: %s", exc)
