import asyncio
import logging
import time

from odds.models import CanonicalEvent
from providers import OddsProvider
from publisher import OddsPublisher
from storage import OddsStorage

logger = logging.getLogger(__name__)

# Bounds on the results poll (see `OddsStorage.list_unresolved`). Kickoffs newer
# than the grace window are likely still in play; older than the lookback are
# past the point of chasing, which also drops fixtures that never reach a final
# status. The cap keeps a backlog from turning one tick into dozens of requests.
RESULTS_GRACE_MS = 2 * 60 * 60 * 1000  # 2 hours
RESULTS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000  # 7 days
RESULTS_MAX_PENDING = 100


async def _pending_events(
    provider: OddsProvider, storage: OddsStorage
) -> list[CanonicalEvent]:
    """This provider's kicked-off-but-unresolved events, or nothing to check."""
    if not provider.polls_results:
        return []
    now = int(time.time() * 1000)
    return await storage.list_unresolved(
        provider.name,
        now - RESULTS_LOOKBACK_MS,
        now - RESULTS_GRACE_MS,
        RESULTS_MAX_PENDING,
    )


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
                async for result in provider.fetch_results(
                    await _pending_events(provider, storage)
                ):
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
