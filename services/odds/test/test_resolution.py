"""Admin resolution guard, end to end against a real Postgres: only mock-origin
events may be resolved manually, and a rejected resolution must not persist.

Storage is the real PostgresStorage (seeded per test); only the RabbitMQ
publisher is faked, since the broker isn't what this guard is about.
"""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from auth import require_admin
from odds import router as odds_router
from odds.models import CanonicalEvent, EventResult, Market, Selection
from publisher.dependencies import get_odds_publisher
from storage.dependencies import get_odds_storage
from storage.postgres import PostgresStorage


class FakePublisher:
    def __init__(self) -> None:
        self.published: list[EventResult] = []

    async def publish_result(self, result: EventResult) -> None:
        self.published.append(result)


def _event(origin: str) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=f"{origin}:e1",
        origin=origin,
        source_event_id="e1",
        sport="soccer_epl",
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


def _client(storage: PostgresStorage, publisher: FakePublisher) -> AsyncClient:
    app = FastAPI()
    app.include_router(odds_router)
    app.dependency_overrides[get_odds_storage] = lambda: storage
    app.dependency_overrides[get_odds_publisher] = lambda: publisher
    app.dependency_overrides[require_admin] = lambda: None
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_resolve_mock_event_succeeds(storage: PostgresStorage) -> None:
    await storage.record(_event("mock"))
    publisher = FakePublisher()
    async with _client(storage, publisher) as client:
        resp = await client.post(
            "/odds/events/mock:e1/result", json={"outcome": "home"}
        )

    assert resp.status_code == 201
    assert resp.json()["outcome"] == "home"
    # Persisted and fanned out.
    got = await storage.get_current("mock:e1")
    assert got is not None and got.outcome == "home"
    assert len(publisher.published) == 1


@pytest.mark.parametrize("origin", ["theoddsapi", "apifootball"])
async def test_resolve_non_mock_event_rejected(
    origin: str, storage: PostgresStorage
) -> None:
    await storage.record(_event(origin))
    publisher = FakePublisher()
    async with _client(storage, publisher) as client:
        resp = await client.post(
            f"/odds/events/{origin}:e1/result", json={"outcome": "home"}
        )

    assert resp.status_code == 409
    # Nothing recorded, nothing published.
    got = await storage.get_current(f"{origin}:e1")
    assert got is not None and got.outcome is None
    assert publisher.published == []


async def test_resolve_missing_event_404(storage: PostgresStorage) -> None:
    publisher = FakePublisher()
    async with _client(storage, publisher) as client:
        resp = await client.post(
            "/odds/events/mock:gone/result", json={"outcome": "home"}
        )

    assert resp.status_code == 404
    assert publisher.published == []
