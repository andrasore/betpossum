import asyncio
import logging
import time

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
    async with provider:
        while True:
            start = time.monotonic()
            logger.info("Fetch tick starting for provider %s", provider.name)
            events = 0
            results = 0
            try:
                async for event in provider.fetch_tick():
                    await storage.record(event)
                    await publisher.publish(event)
                    events += 1
                async for result in provider.fetch_results():
                    await storage.record_result(result)
                    await publisher.publish_result(result)
                    results += 1
            except Exception:
                elapsed_ms = (time.monotonic() - start) * 1000
                logger.exception(
                    "Fetch tick failed for provider %s after %.1fms "
                    "(%d events, %d results recorded before failure)",
                    provider.name,
                    elapsed_ms,
                    events,
                    results,
                )
            else:
                elapsed_ms = (time.monotonic() - start) * 1000
                logger.info(
                    "Fetch tick done for provider %s in %.1fms (%d events, %d results)",
                    provider.name,
                    elapsed_ms,
                    events,
                    results,
                )
            await asyncio.sleep(interval)
