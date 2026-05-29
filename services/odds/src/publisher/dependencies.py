import os
from typing import Annotated

from fastapi import Depends

from .base import OddsPublisher

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://localhost:5672")

_publisher: OddsPublisher | None = None


def open_publisher() -> OddsPublisher:
    global _publisher
    _publisher = OddsPublisher(RABBITMQ_URL)
    return _publisher


async def close_publisher() -> None:
    global _publisher
    if _publisher is not None:
        await _publisher.close()
    _publisher = None


async def get_odds_publisher() -> OddsPublisher:
    assert _publisher is not None, "publisher requested before startup"
    return _publisher


PublisherDep = Annotated[OddsPublisher, Depends(get_odds_publisher)]
