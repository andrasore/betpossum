import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from auth import require_admin
from models import EventResult, OddsEvent, Outcome
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
    outcome: Outcome | None = None
    resolved_at: int | None = Field(default=None, serialization_alias="resolvedAt")

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
            outcome=event.outcome,
            resolved_at=event.resolved_at,
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    provider = get_provider(PROVIDER_NAME)
    storage = get_storage(STORAGE_NAME)
    publisher = OddsPublisher(RABBITMQ_URL)
    async with storage:
        await storage.init_schema()
        app.state.storage = storage
        app.state.publisher = publisher
        worker = asyncio.create_task(
            run(provider, storage, publisher, POLL_INTERVAL_SECONDS),
            name=f"odds-worker-{PROVIDER_NAME}-{STORAGE_NAME}",
        )
        try:
            yield
        finally:
            worker.cancel()
            await publisher.close()


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


def _publisher(app: FastAPI) -> OddsPublisher:
    publisher = getattr(app.state, "publisher", None)
    assert publisher is not None, "publisher not initialised"
    return publisher


class ResolveEventRequest(BaseModel):
    outcome: Outcome


class ResolveEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    outcome: Outcome
    resolved_at: int = Field(serialization_alias="resolvedAt")


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


# Admin action: resolve an event and fan out the result. Auth is enforced via
# a Keycloak access token requiring the `admin` realm role.
@app.post(
    "/odds/{event_id}/result",
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def resolve_event(event_id: str, body: ResolveEventRequest) -> dict[str, object]:
    storage = _storage(app)
    current = await storage.get_current(event_id)
    sport = current.sport if current is not None else ""
    result = EventResult(
        event_id=event_id,
        sport=sport,
        outcome=body.outcome,
        resolved_at=int(time.time() * 1000),
    )
    await storage.record_result(result)
    await _publisher(app).publish_result(result)
    return ResolveEventResponse(
        event_id=result.event_id,
        outcome=result.outcome,
        resolved_at=result.resolved_at,
    ).model_dump(by_alias=True)
