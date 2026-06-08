"""GET /odds/sports, end to end against a real Postgres: the canonical sport
chips the dashboard filter bar is built from.

Storage is the real PostgresStorage (seeded per test); the endpoint reads the
de-duplicated `sport` reference table, so two soccer leagues surface as one
"soccer" chip.
"""

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from odds import router as odds_router
from odds.models import CanonicalEvent, Market, Selection
from storage.dependencies import get_odds_storage
from storage.postgres import PostgresStorage


def _event(event_id: str, sport: str) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=event_id,
        origin="mock",
        source_event_id=event_id.split(":", 1)[-1],
        sport=sport,
        home_team="A",
        away_team="B",
        markets=[
            Market(
                key="h2h",
                selections=[
                    Selection(key="home", name="A", odds=1.5),
                    Selection(key="away", name="B", odds=2.5),
                ],
            )
        ],
        updated_at=1,
    )


def _client(storage: PostgresStorage) -> AsyncClient:
    app = FastAPI()
    app.include_router(odds_router)
    app.dependency_overrides[get_odds_storage] = lambda: storage
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_list_sports_returns_canonical_chips(storage: PostgresStorage) -> None:
    await storage.record(_event("mock:a", "soccer_epl"))
    await storage.record(_event("mock:b", "soccer_laliga"))
    await storage.record(_event("mock:c", "basketball_nba"))

    async with _client(storage) as client:
        resp = await client.get("/odds/sports")

    assert resp.status_code == 200
    # Deduped to one chip per canonical sport, ordered by display name.
    assert resp.json() == [
        {"slug": "basketball", "name": "Basketball"},
        {"slug": "soccer", "name": "Soccer"},
    ]


async def test_list_sports_empty_when_no_events(storage: PostgresStorage) -> None:
    async with _client(storage) as client:
        resp = await client.get("/odds/sports")

    assert resp.status_code == 200
    assert resp.json() == []


async def test_sports_route_not_captured_as_event_id(storage: PostgresStorage) -> None:
    # The /sports route must win over /{event_id}; otherwise this would 404 as a
    # missing event lookup.
    async with _client(storage) as client:
        resp = await client.get("/odds/sports")

    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
