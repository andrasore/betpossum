"""Admin resolution guard: only mock-origin events may be resolved manually."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import require_admin
from odds import router as odds_router
from odds.models import CanonicalEvent, EventResult
from publisher.dependencies import get_odds_publisher
from storage.dependencies import get_odds_storage


class FakeStorage:
    def __init__(self, event: CanonicalEvent | None):
        self._event = event
        self.recorded: list[EventResult] = []

    async def get_current(self, event_id: str) -> CanonicalEvent | None:
        return self._event

    async def record_result(self, result: EventResult) -> None:
        self.recorded.append(result)


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
        markets=[],
        updated_at=1,
    )


def _client(storage: FakeStorage) -> TestClient:
    app = FastAPI()
    app.include_router(odds_router)
    app.dependency_overrides[get_odds_storage] = lambda: storage
    app.dependency_overrides[get_odds_publisher] = lambda: FakePublisher()
    app.dependency_overrides[require_admin] = lambda: None
    return TestClient(app)


def test_resolve_mock_event_succeeds() -> None:
    storage = FakeStorage(_event("mock"))
    resp = _client(storage).post("/odds/mock:e1/result", json={"outcome": "home"})
    assert resp.status_code == 201
    assert resp.json()["outcome"] == "home"
    assert len(storage.recorded) == 1


@pytest.mark.parametrize("origin", ["theoddsapi", "apifootball"])
def test_resolve_non_mock_event_rejected(origin: str) -> None:
    storage = FakeStorage(_event(origin))
    resp = _client(storage).post(f"/odds/{origin}:e1/result", json={"outcome": "home"})
    assert resp.status_code == 409
    assert storage.recorded == []


def test_resolve_missing_event_404() -> None:
    storage = FakeStorage(None)
    resp = _client(storage).post("/odds/mock:gone/result", json={"outcome": "home"})
    assert resp.status_code == 404
