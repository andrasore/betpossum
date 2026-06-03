"""Entity resolution at ingest, against a real Postgres: PostgresStorage.record
creates and links canonical sport/league/team rows, merges two providers whose
labels reduce to the same match key, enriches a country one provider lacked, and
stays idempotent on re-ingest.

This is the DB boundary the pure normalizer can't cover — the ON CONFLICT
upserts, the RETURNING-id round-trip, and the unique (sport, match_key) index
actually doing the merge.
"""

from typing import Any

from sqlalchemy import text

from odds.models import CanonicalEvent, Market, Selection
from storage.postgres import PostgresStorage


def _event(
    *,
    origin: str,
    source_id: str,
    sport: str = "soccer_epl",
    league_key: str | None = "soccer_epl",
    league_name: str | None = "Premier League",
    country: str | None = "England",
    home_team: str = "Arsenal",
    away_team: str = "Chelsea",
    home_team_key: str | None = None,
    away_team_key: str | None = None,
) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=f"{origin}:{source_id}",
        origin=origin,
        source_event_id=source_id,
        sport=sport,
        home_team=home_team,
        away_team=away_team,
        markets=[
            Market(
                key="h2h",
                selections=[
                    Selection(key="home", name="H", odds=1.5),
                    Selection(key="away", name="A", odds=2.5),
                ],
            )
        ],
        updated_at=1000,
        league_key=league_key,
        league_name=league_name,
        country=country,
        home_team_key=home_team_key,
        away_team_key=away_team_key,
    )


async def _scalar(
    storage: PostgresStorage, sql: str, params: dict[str, Any] | None = None
) -> Any:
    assert storage._engine is not None
    async with storage._engine.connect() as conn:
        result = await conn.execute(text(sql), params or {})
        return result.scalar_one()


async def _column(storage: PostgresStorage, sql: str) -> list[Any]:
    assert storage._engine is not None
    async with storage._engine.connect() as conn:
        result = await conn.execute(text(sql))
        return [row[0] for row in result.all()]


async def test_record_creates_and_links_entities(storage: PostgresStorage) -> None:
    await storage.record(_event(origin="mock", source_id="epl-001"))

    assert await _scalar(storage, "SELECT slug FROM sport") == "soccer"
    assert await _scalar(storage, "SELECT match_key FROM league") == "premier league"
    assert await _scalar(storage, "SELECT count(*) FROM team") == 2

    # The odds row carries the resolved canonical links.
    assert await _scalar(storage, "SELECT sport_slug FROM odds_current") == "soccer"
    assert await _scalar(storage, "SELECT league_id FROM odds_current") is not None
    assert await _scalar(storage, "SELECT home_team_id FROM odds_current") is not None
    assert await _scalar(storage, "SELECT away_team_id FROM odds_current") is not None


async def test_two_providers_merge_onto_one_league_and_team(
    storage: PostgresStorage,
) -> None:
    # The Odds API: short team name, no ids, league "EPL", no country.
    await storage.record(
        _event(
            origin="theoddsapi",
            source_id="x1",
            league_key="soccer_epl",
            league_name="EPL",
            country=None,
            home_team="Man City",
            away_team="Chelsea",
        )
    )
    # API-Football: full name + numeric ids, league "Premier League" / England.
    await storage.record(
        _event(
            origin="apifootball",
            source_id="42",
            league_key="39",
            league_name="Premier League",
            country="England",
            home_team="Manchester City",
            away_team="Chelsea",
            home_team_key="50",
            away_team_key="49",
        )
    )

    # One canonical league, enriched with the country the odds API lacked...
    assert await _scalar(storage, "SELECT count(*) FROM league") == 1
    assert await _scalar(storage, "SELECT country FROM league") == "England"
    # ...reached from both providers via distinct source keys.
    assert await _scalar(storage, "SELECT count(*) FROM league_source_map") == 2

    # "Man City" and "Manchester City" collapsed; Chelsea shared -> 2 teams.
    assert await _scalar(storage, "SELECT count(*) FROM team") == 2

    home_ids = await _column(
        storage, "SELECT home_team_id FROM odds_current ORDER BY event_id"
    )
    league_ids = await _column(storage, "SELECT league_id FROM odds_current")
    assert home_ids[0] == home_ids[1]
    assert len(set(league_ids)) == 1


async def test_distinct_names_stay_separate(storage: PostgresStorage) -> None:
    await storage.record(
        _event(origin="mock", source_id="a", home_team="Arsenal", away_team="Chelsea")
    )
    await storage.record(
        _event(origin="mock", source_id="b", home_team="Liverpool", away_team="Everton")
    )
    assert await _scalar(storage, "SELECT count(*) FROM team") == 4


async def test_reingest_is_idempotent(storage: PostgresStorage) -> None:
    event = _event(origin="mock", source_id="epl-001")
    await storage.record(event)
    await storage.record(event)

    assert await _scalar(storage, "SELECT count(*) FROM league") == 1
    assert await _scalar(storage, "SELECT count(*) FROM team") == 2
    assert await _scalar(storage, "SELECT count(*) FROM league_source_map") == 1
    assert await _scalar(storage, "SELECT count(*) FROM team_source_map") == 2


async def test_missing_league_leaves_link_null_but_resolves_sport(
    storage: PostgresStorage,
) -> None:
    await storage.record(
        _event(
            origin="mock",
            source_id="z",
            league_key=None,
            league_name=None,
            country=None,
        )
    )
    assert await _scalar(storage, "SELECT league_id FROM odds_current") is None
    assert await _scalar(storage, "SELECT count(*) FROM league") == 0
    assert await _scalar(storage, "SELECT sport_slug FROM odds_current") == "soccer"


async def test_americanfootball_sport_slug_normalized(
    storage: PostgresStorage,
) -> None:
    await storage.record(
        _event(
            origin="mock",
            source_id="n",
            sport="americanfootball_nfl",
            league_key="americanfootball_nfl",
            league_name="NFL",
            country="USA",
            home_team="Kansas City Chiefs",
            away_team="San Francisco 49ers",
        )
    )
    assert await _scalar(storage, "SELECT sport_slug FROM odds_current") == (
        "american_football"
    )
