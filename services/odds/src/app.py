import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from fastapi import FastAPI, Request, Response

from odds import router as odds_router
from providers import get_provider
from publisher.dependencies import close_publisher, open_publisher
from runner import run
from storage.dependencies import STORAGE_NAME, close_storage, open_storage

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


app.include_router(odds_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": PROVIDER_NAME, "storage": STORAGE_NAME}
