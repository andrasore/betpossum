import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from models import OddsEvent
from providers import get_provider
from publisher import OddsPublisher
from runner import run
from storage import OddsStorage, get_storage

logging.basicConfig(level=logging.INFO)
http_logger = logging.getLogger("odds.http")

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://localhost:5672")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
PROVIDER_NAME = os.environ.get("ODDS_PROVIDER", "mock")
STORAGE_NAME = os.environ.get("ODDS_STORAGE", "postgres")


class OddsEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    sport: str
    home_team: str = Field(serialization_alias="homeTeam")
    away_team: str = Field(serialization_alias="awayTeam")
    home_odds: float = Field(serialization_alias="homeOdds")
    away_odds: float = Field(serialization_alias="awayOdds")
    draw_odds: float = Field(serialization_alias="drawOdds")
    updated_at: int = Field(serialization_alias="updatedAt")

    @classmethod
    def from_event(cls, event: OddsEvent) -> "OddsEventResponse":
        return cls(
            event_id=event.event_id,
            sport=event.sport,
            home_team=event.home_team,
            away_team=event.away_team,
            home_odds=event.home_odds,
            away_odds=event.away_odds,
            draw_odds=event.draw_odds,
            updated_at=event.updated_at,
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    provider = get_provider(PROVIDER_NAME)
    storage = get_storage(STORAGE_NAME)
    publisher = OddsPublisher(RABBITMQ_URL)
    async with storage:
        await storage.init_schema()
        app.state.storage = storage
        worker = asyncio.create_task(
            run(provider, storage, publisher, POLL_INTERVAL_SECONDS),
            name=f"odds-worker-{PROVIDER_NAME}-{STORAGE_NAME}",
        )
        try:
            yield
        finally:
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass


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


def _storage(app: FastAPI) -> OddsStorage:
    storage = getattr(app.state, "storage", None)
    assert storage is not None, "storage not initialised"
    return storage


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": PROVIDER_NAME, "storage": STORAGE_NAME}


@app.get("/odds")
async def list_odds(sport: str | None = None) -> list[dict[str, object]]:
    events = await _storage(app).list_current(sport)
    return [OddsEventResponse.from_event(e).model_dump(by_alias=True) for e in events]


@app.get("/odds/{event_id}")
async def get_odds(event_id: str) -> dict[str, object]:
    event = await _storage(app).get_current(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return OddsEventResponse.from_event(event).model_dump(by_alias=True)
