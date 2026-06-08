"""GET /odds/leagues and the GET /odds ?league filter, end to end against a real
Postgres: the canonical league chips the dashboard's league filter bar is built
from, plus the server-side narrowing a chip triggers.

Storage is the real PostgresStorage (seeded per test); the endpoint reads the
de-duplicated `league` reference table, and the filter joins through
`odds_current.league_id`.
"""

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from odds import router as odds_router
from odds.models import CanonicalEvent, Market, Selection
from storage.dependencies import get_odds_storage
from storage.postgres import PostgresStorage


def _event(event_id: str, sport: str, league: str) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=event_id,
        origin="mock",
        source_event_id=event_id.split(":", 1)[-1],
        sport=sport,
        home_team="A",
        away_team="B",
        # Both must be set for the storage entity resolver to persist a league.
        league_key=league,
        league_name=league,
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


async def test_list_leagues_returns_canonical_chips(
    storage: PostgresStorage,
) -> None:
    await storage.record(_event("mock:a", "soccer_epl", "Premier League"))
    await storage.record(_event("mock:b", "soccer_laliga", "La Liga"))
    await storage.record(_event("mock:c", "basketball_nba", "NBA"))

    async with _client(storage) as client:
        resp = await client.get("/odds/leagues")

    assert resp.status_code == 200
    leagues = resp.json()
    # Ordered by league name; each carries its parent sport slug.
    assert [(lg["name"], lg["sportSlug"]) for lg in leagues] == [
        ("La Liga", "soccer"),
        ("NBA", "basketball"),
        ("Premier League", "soccer"),
    ]
    assert all(isinstance(lg["id"], int) for lg in leagues)


async def test_list_leagues_scoped_to_sport(storage: PostgresStorage) -> None:
    await storage.record(_event("mock:a", "soccer_epl", "Premier League"))
    await storage.record(_event("mock:b", "soccer_laliga", "La Liga"))
    await storage.record(_event("mock:c", "basketball_nba", "NBA"))

    async with _client(storage) as client:
        resp = await client.get("/odds/leagues", params={"sport": "soccer"})

    assert resp.status_code == 200
    assert {lg["name"] for lg in resp.json()} == {"Premier League", "La Liga"}


async def test_odds_filtered_by_league_id(storage: PostgresStorage) -> None:
    await storage.record(_event("mock:a", "soccer_epl", "Premier League"))
    await storage.record(_event("mock:b", "basketball_nba", "NBA"))

    async with _client(storage) as client:
        leagues = (await client.get("/odds/leagues")).json()
        epl_id = next(lg["id"] for lg in leagues if lg["name"] == "Premier League")
        resp = await client.get("/odds", params={"league": epl_id})

    assert resp.status_code == 200
    events = resp.json()
    # Only the Premier League event survives the filter, and it reports the id.
    assert [e["eventId"] for e in events] == ["mock:a"]
    assert events[0]["leagueId"] == epl_id


async def test_leagues_route_not_captured_as_event_id(
    storage: PostgresStorage,
) -> None:
    # The /leagues route must win over /{event_id}; otherwise this would 404 as
    # a missing event lookup.
    async with _client(storage) as client:
        resp = await client.get("/odds/leagues")

    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
