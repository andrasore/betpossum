import time

from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from publisher.dependencies import PublisherDep
from storage.dependencies import StorageDep

from .models import EventResult
from .schemas import OddsEventResponse, ResolveEventRequest, ResolveEventResponse

router = APIRouter(prefix="/odds", tags=["odds"])


@router.get("")
async def list_odds(
    storage: StorageDep, sport: str | None = None
) -> list[dict[str, object]]:
    events = await storage.list_current(sport)
    return [OddsEventResponse.from_event(e).model_dump(by_alias=True) for e in events]


@router.get("/{event_id}")
async def get_odds(event_id: str, storage: StorageDep) -> dict[str, object]:
    event = await storage.get_current(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return OddsEventResponse.from_event(event).model_dump(by_alias=True)


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
