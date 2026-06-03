import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from fastapi import FastAPI, Request, Response

from odds import router as odds_router
from providers import get_providers
from publisher.dependencies import close_publisher, open_publisher
from runner import run
from storage.dependencies import STORAGE_NAME, close_storage, open_storage

logging.basicConfig(level=logging.INFO)
http_logger = logging.getLogger("odds.http")
logger = logging.getLogger("odds")

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
# Multiple providers may be enabled at once; each runs its own concurrent poll
# loop. Falls back to the legacy single ODDS_PROVIDER var, then to mock.
try:
    ODDS_PROVIDERS = os.environ.get("ODDS_PROVIDERS", "mock")
except KeyError as e:
    logger.error("ODDS_PROVIDERS not defined, exiting")
    raise e

PROVIDER_NAMES = [name.strip() for name in ODDS_PROVIDERS.split(",") if name.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    providers = get_providers(PROVIDER_NAMES)
    logger.info("Enabled odds providers: %s", ", ".join(p.name for p in providers))
    storage = await open_storage()
    publisher = open_publisher()
    workers = [
        asyncio.create_task(
            run(provider, storage, publisher, POLL_INTERVAL_SECONDS),
            name=f"odds-worker-{provider.name}-{STORAGE_NAME}",
        )
        for provider in providers
    ]
    try:
        yield
    finally:
        for worker in workers:
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


app.include_router(odds_router)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "providers": PROVIDER_NAMES, "storage": STORAGE_NAME}
