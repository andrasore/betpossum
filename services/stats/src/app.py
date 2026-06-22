import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from fastapi import FastAPI, Request, Response

from consumer import run as run_consumer
from routes import router as stats_router
from storage.dependencies import close_storage, open_storage

logging.basicConfig(level=logging.INFO)
http_logger = logging.getLogger("stats.http")
logger = logging.getLogger("stats")

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://localhost:5672")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    store = await open_storage()
    consumer = asyncio.create_task(
        run_consumer(RABBITMQ_URL, store), name="stats-consumer"
    )
    try:
        yield
    finally:
        consumer.cancel()
        try:
            await consumer
        except asyncio.CancelledError:
            pass
        await close_storage()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    start = time.monotonic()
    query = f"?{request.url.query}" if request.url.query else ""
    http_logger.info("→ %s %s%s", request.method, request.url.path, query)
    response = await call_next(request)
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


app.include_router(stats_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
