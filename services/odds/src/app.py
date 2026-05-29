import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Request, Response

from auth import require_admin
from models import EventResult
from providers import get_provider
from publisher.dependencies import PublisherDep, close_publisher, open_publisher
from runner import run
from schemas import OddsEventResponse, ResolveEventRequest, ResolveEventResponse
from storage.dependencies import STORAGE_NAME, StorageDep, close_storage, open_storage

logging.basicConfig(level=logging.INFO)
http_logger = logging.getLogger("odds.http")

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
PROVIDER_NAME = os.environ.get("ODDS_PROVIDER", "mock")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    provider = get_provider(PROVIDER_NAME)
    storage = await open_storage()
    publisher = open_publisher()
    worker = asyncio.create_task(
        run(provider, storage, publisher, POLL_INTERVAL_SECONDS),
        name=f"odds-worker-{PROVIDER_NAME}-{STORAGE_NAME}",
    )
    try:
        yield
    finally:
        worker.cancel()
        await close_publisher()
        await close_storage()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    start = time.monotonic()
    query = f"?{request.url.query}" if request.url.query else ""
    http_logger.info("→ %s %s%s", request.method, request.url.path, query)
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.monotonic() - start) * 1000
        http_logger.exception(
            "← %s %s%s 500 (%.1fms)",
            request.method,
            request.url.path,
            query,
            elapsed_ms,
        )
        raise
    elapsed_ms = (time.monotonic() - start) * 1000
    http_logger.info(
        "← %s %s%s %d (%.1fms)",
        request.method,
        request.url.path,
        query,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": PROVIDER_NAME, "storage": STORAGE_NAME}


@app.get("/odds")
async def list_odds(
    storage: StorageDep, sport: str | None = None
) -> list[dict[str, object]]:
    events = await storage.list_current(sport)
    return [OddsEventResponse.from_event(e).model_dump(by_alias=True) for e in events]


@app.get("/odds/{event_id}")
async def get_odds(event_id: str, storage: StorageDep) -> dict[str, object]:
    event = await storage.get_current(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return OddsEventResponse.from_event(event).model_dump(by_alias=True)


# Admin action: resolve an event and fan out the result. Auth is enforced via
# a Keycloak access token requiring the `admin` realm role.
@app.post(
    "/odds/{event_id}/result",
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def resolve_event(
    event_id: str,
    body: ResolveEventRequest,
    storage: StorageDep,
    publisher: PublisherDep,
) -> dict[str, object]:
    current = await storage.get_current(event_id)
    sport = current.sport if current is not None else ""
    result = EventResult(
        event_id=event_id,
        sport=sport,
        outcome=body.outcome,
        resolved_at=int(time.time() * 1000),
    )
    await storage.record_result(result)
    await publisher.publish_result(result)
    return ResolveEventResponse(
        event_id=result.event_id,
        outcome=result.outcome,
        resolved_at=result.resolved_at,
    ).model_dump(by_alias=True)
