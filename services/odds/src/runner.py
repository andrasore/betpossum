import asyncio
import logging

from providers import OddsProvider
from publisher import OddsPublisher
from storage import OddsStorage

logger = logging.getLogger(__name__)


async def run(
    provider: OddsProvider,
    storage: OddsStorage,
    publisher: OddsPublisher,
    interval: int,
) -> None:
    async with provider, storage:
        await storage.init_schema()
        while True:
            try:
                async for event in provider.fetch_tick():
                    await storage.record(event)
                    await publisher.publish(event)
            except Exception:
                logger.exception("Tick failed for provider %s", provider.name)
            await asyncio.sleep(interval)
