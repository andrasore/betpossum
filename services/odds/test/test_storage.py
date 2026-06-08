"""PostgresStorage against a real Postgres: JSONB round-trips, upsert vs the
history append, ordering/filtering, and the defensive result upsert.

These exercise the actual SQL boundary — the kind of thing a mocked store can't
catch (a JSONB serialisation slip, an ON CONFLICT clause that clobbers the wrong
columns, a missing index column).
"""

from sqlalchemy import text

from odds.models import CanonicalEvent, EventResult, Market, Selection
from storage.postgres import PostgresStorage


def _h2h(home: float, away: float, draw: float | None = None) -> Market:
    selections = [
        Selection(key="home", name="A", odds=home),
        Selection(key="away", name="B", odds=away),
    ]
    if draw is not None:
        selections.append(Selection(key="draw", name="Draw", odds=draw))
    return Market(key="h2h", selections=selections)


def _event(
    event_id: str = "mock:e1",
    *,
    origin: str = "mock",
    sport: str = "soccer_epl",
    updated_at: int = 1000,
    markets: list[Market] | None = None,
) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=event_id,
        origin=origin,
        source_event_id=event_id.split(":", 1)[-1],
        sport=sport,
        home_team="A",
        away_team="B",
        commence_time=1717200000000,
        markets=markets
        if markets is not None
        else [
            _h2h(1.5, 2.5, 3.2),
            Market(
                key="totals",
                selections=[
                    Selection(key="over", name="Over", odds=1.9, point=2.5),
                    Selection(key="under", name="Under", odds=1.95, point=2.5),
                ],
            ),
        ],
        updated_at=updated_at,
    )


async def _history_count(storage: PostgresStorage, event_id: str) -> int:
    assert storage._engine is not None
    async with storage._engine.connect() as conn:
        result = await conn.execute(
            text("SELECT count(*) FROM odds_history WHERE event_id = :e"),
            {"e": event_id},
        )
        return result.scalar_one()


async def test_record_then_get_roundtrips_full_market_model(
    storage: PostgresStorage,
) -> None:
    await storage.record(_event())

    got = await storage.get_current("mock:e1")
    assert got is not None
    assert got.origin == "mock"
    assert got.source_event_id == "e1"
    assert got.commence_time == 1717200000000

    h2h = got.market("h2h")
    assert h2h is not None
    assert {s.key: s.odds for s in h2h.selections} == {
        "home": 1.5,
        "away": 2.5,
        "draw": 3.2,
    }
    # Non-h2h markets and their `point` survive the JSONB round-trip.
    totals = got.market("totals")
    assert totals is not None
    over = next(s for s in totals.selections if s.key == "over")
    assert over.point == 2.5


async def test_get_current_unknown_returns_none(storage: PostgresStorage) -> None:
    assert await storage.get_current("mock:nope") is None


async def test_record_upserts_current_but_appends_history(
    storage: PostgresStorage,
) -> None:
    await storage.record(_event(updated_at=1000))
    await storage.record(_event(updated_at=2000, markets=[_h2h(1.1, 9.0)]))

    got = await storage.get_current("mock:e1")
    assert got is not None
    # odds_current is upserted to the latest tick...
    assert got.updated_at == 2000
    h2h = got.market("h2h")
    assert h2h is not None
    assert {s.key: s.odds for s in h2h.selections}["home"] == 1.1
    # ...while odds_history keeps every tick.
    assert await _history_count(storage, "mock:e1") == 2


async def test_list_current_orders_by_updated_desc_and_filters_sport(
    storage: PostgresStorage,
) -> None:
    await storage.record(_event("mock:a", sport="soccer_epl", updated_at=100))
    await storage.record(_event("mock:b", sport="soccer_epl", updated_at=300))
    await storage.record(_event("mock:c", sport="basketball_nba", updated_at=200))

    assert [e.event_id for e in await storage.list_current()] == [
        "mock:b",
        "mock:c",
        "mock:a",
    ]
    # Filtering is by canonical sport slug (soccer_epl -> "soccer"), so both
    # soccer events match while the basketball one is excluded.
    assert [e.event_id for e in await storage.list_current("soccer")] == [
        "mock:b",
        "mock:a",
    ]


async def test_list_sports_returns_deduped_canonical_sports(
    storage: PostgresStorage,
) -> None:
    await storage.record(_event("mock:a", sport="soccer_epl", updated_at=100))
    await storage.record(_event("mock:b", sport="soccer_laliga", updated_at=200))
    await storage.record(_event("mock:c", sport="basketball_nba", updated_at=300))

    sports = await storage.list_sports()
    # Both soccer leagues collapse onto one canonical "soccer"; ordered by title.
    assert [(s.slug, s.title) for s in sports] == [
        ("basketball", "Basketball"),
        ("soccer", "Soccer"),
    ]


async def test_record_result_sets_outcome_without_clobbering_odds(
    storage: PostgresStorage,
) -> None:
    await storage.record(_event())
    await storage.record_result(
        EventResult(
            event_id="mock:e1", sport="soccer_epl", outcome="home", resolved_at=5000
        )
    )

    got = await storage.get_current("mock:e1")
    assert got is not None
    assert got.outcome == "home"
    assert got.resolved_at == 5000
    # The conflict path updates only outcome/resolved_at — odds stay put.
    assert got.market("h2h") is not None


async def test_record_result_on_unknown_event_inserts_bare_mock_row(
    storage: PostgresStorage,
) -> None:
    await storage.record_result(
        EventResult(
            event_id="mock:bare", sport="soccer_epl", outcome="draw", resolved_at=7000
        )
    )

    got = await storage.get_current("mock:bare")
    assert got is not None
    assert got.origin == "mock"
    assert got.outcome == "draw"
    assert got.markets == []
