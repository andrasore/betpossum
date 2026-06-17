import time

from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from publisher.dependencies import PublisherDep
from storage.dependencies import StorageDep

from .models import EventResult
from .schemas import (
    ResolveEventRequest,
    ResolveEventResponse,
    event_to_response,
    league_to_response,
    sport_to_response,
)

router = APIRouter(prefix="/odds", tags=["odds"])


@router.get("")
async def list_odds(
    storage: StorageDep, sport: str | None = None, league: int | None = None
) -> list[dict[str, object]]:
    events = await storage.list_current(sport, league)
    return [event_to_response(e).model_dump() for e in events]


# Declared before `/{event_id}` so "sports" isn't captured as an event id.
@router.get("/sports")
async def list_sports(storage: StorageDep) -> list[dict[str, object]]:
    sports = await storage.list_sports()
    return [sport_to_response(s).model_dump() for s in sports]


# Declared before `/{event_id}` so "leagues" isn't captured as an event id.
@router.get("/leagues")
async def list_leagues(
    storage: StorageDep, sport: str | None = None
) -> list[dict[str, object]]:
    leagues = await storage.list_leagues(sport)
    return [league_to_response(lg).model_dump() for lg in leagues]


@router.get("/{event_id}")
async def get_odds(event_id: str, storage: StorageDep) -> dict[str, object]:
    event = await storage.get_current(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return event_to_response(event).model_dump()


# Admin action: resolve an event and fan out the result. Auth is enforced via
# a Keycloak access token requiring the `admin` realm role.
@router.post(
    "/{event_id}/result",
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
    if current is None:
        raise HTTPException(status_code=404, detail="event not found")
    # Manual resolution is restricted to mock-origin events so we never have to
    # reconcile a real provider's own settlement against ours.
    if current.origin != "mock":
        raise HTTPException(
            status_code=409,
            detail="manual resolution is only allowed for mock-origin events",
        )
    result = EventResult(
        event_id=event_id,
        sport=current.sport,
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
