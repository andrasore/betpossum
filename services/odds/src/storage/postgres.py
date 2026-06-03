# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false
# asyncpg ships no type stubs; rather than peppering every call site with
# per-line ignores, silence the unknown-types family for this file only.

import json
import logging
import os
from types import TracebackType
from typing import Any, ClassVar

# TODO maybe use sqlalchemy
import asyncpg

from odds.models import CanonicalEvent, EventResult, Market, h2h_odds
from .base import OddsStorage

logger = logging.getLogger(__name__)

_SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS odds_current (
      event_id      TEXT PRIMARY KEY,
      origin        TEXT NOT NULL DEFAULT '',
      sport         TEXT NOT NULL,
      home_team     TEXT NOT NULL,
      away_team     TEXT NOT NULL,
      home_odds     DOUBLE PRECISION NOT NULL,
      away_odds     DOUBLE PRECISION NOT NULL,
      draw_odds     DOUBLE PRECISION NOT NULL DEFAULT 0,
      markets       JSONB NOT NULL DEFAULT '[]',
      commence_time BIGINT,
      updated_at    BIGINT NOT NULL,
      outcome       TEXT,
      resolved_at   BIGINT
    )
    """,
    # Backfill columns for installs created before these fields existed.
    "ALTER TABLE odds_current ADD COLUMN IF NOT EXISTS outcome TEXT",
    "ALTER TABLE odds_current ADD COLUMN IF NOT EXISTS resolved_at BIGINT",
    "ALTER TABLE odds_current ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE odds_current ADD COLUMN IF NOT EXISTS markets JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE odds_current ADD COLUMN IF NOT EXISTS commence_time BIGINT",
    """
    CREATE TABLE IF NOT EXISTS odds_history (
      id         BIGSERIAL PRIMARY KEY,
      event_id   TEXT NOT NULL,
      sport      TEXT NOT NULL,
      home_team  TEXT NOT NULL,
      away_team  TEXT NOT NULL,
      home_odds  DOUBLE PRECISION NOT NULL,
      away_odds  DOUBLE PRECISION NOT NULL,
      draw_odds  DOUBLE PRECISION NOT NULL DEFAULT 0,
      markets    JSONB NOT NULL DEFAULT '[]',
      updated_at BIGINT NOT NULL
    )
    """,
    "ALTER TABLE odds_history ADD COLUMN IF NOT EXISTS markets JSONB NOT NULL DEFAULT '[]'",
    """
    CREATE INDEX IF NOT EXISTS idx_history_event_time
      ON odds_history (event_id, updated_at DESC)
    """,
    # Maps our canonical event ids back to each provider's original ids.
    """
    CREATE TABLE IF NOT EXISTS event_source_map (
      provider           TEXT NOT NULL,
      source_event_id    TEXT NOT NULL,
      canonical_event_id TEXT NOT NULL,
      source_sport       TEXT,
      updated_at         BIGINT NOT NULL,
      PRIMARY KEY (provider, source_event_id)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_source_map_canonical
      ON event_source_map (canonical_event_id)
    """,
]

_INSERT_HISTORY = """
INSERT INTO odds_history
  (event_id, sport, home_team, away_team, home_odds, away_odds, draw_odds,
   markets, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
"""

_UPSERT_CURRENT = """
INSERT INTO odds_current
  (event_id, origin, sport, home_team, away_team, home_odds, away_odds,
   draw_odds, markets, commence_time, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (event_id) DO UPDATE SET
  origin        = EXCLUDED.origin,
  sport         = EXCLUDED.sport,
  home_team     = EXCLUDED.home_team,
  away_team     = EXCLUDED.away_team,
  home_odds     = EXCLUDED.home_odds,
  away_odds     = EXCLUDED.away_odds,
  draw_odds     = EXCLUDED.draw_odds,
  markets       = EXCLUDED.markets,
  commence_time = EXCLUDED.commence_time,
  updated_at    = EXCLUDED.updated_at
"""

_UPSERT_SOURCE_MAP = """
INSERT INTO event_source_map
  (provider, source_event_id, canonical_event_id, source_sport, updated_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (provider, source_event_id) DO UPDATE SET
  canonical_event_id = EXCLUDED.canonical_event_id,
  source_sport       = EXCLUDED.source_sport,
  updated_at         = EXCLUDED.updated_at
"""

_SELECT_COLS = (
    "event_id, origin, sport, home_team, away_team, markets, commence_time, "
    "updated_at, outcome, resolved_at"
)

_SELECT_ALL = f"SELECT {_SELECT_COLS} FROM odds_current ORDER BY updated_at DESC"
_SELECT_BY_SPORT = (
    f"SELECT {_SELECT_COLS} FROM odds_current WHERE sport = $1 ORDER BY updated_at DESC"
)
_SELECT_BY_EVENT = f"SELECT {_SELECT_COLS} FROM odds_current WHERE event_id = $1"

# An admin-driven resolution can only target a mock-origin event that already
# exists (the route enforces both), but keep the upsert defensive: a bare row
# can only originate from mock.
_UPSERT_RESULT = """
INSERT INTO odds_current
  (event_id, origin, sport, home_team, away_team, home_odds, away_odds,
   draw_odds, markets, updated_at, outcome, resolved_at)
VALUES ($1, 'mock', $2, '', '', 0, 0, 0, '[]', 0, $3, $4)
ON CONFLICT (event_id) DO UPDATE SET
  outcome     = EXCLUDED.outcome,
  resolved_at = EXCLUDED.resolved_at
"""


def _row_to_event(row: Any) -> CanonicalEvent:
    raw_markets = row["markets"]
    market_dicts = (
        json.loads(raw_markets) if isinstance(raw_markets, str) else raw_markets
    )
    markets = [Market.model_validate(m) for m in market_dicts]
    return CanonicalEvent(
        event_id=row["event_id"],
        origin=row["origin"],
        source_event_id=row["event_id"].split(":", 1)[-1],
        sport=row["sport"],
        home_team=row["home_team"],
        away_team=row["away_team"],
        commence_time=row["commence_time"],
        markets=markets,
        updated_at=row["updated_at"],
        outcome=row["outcome"],
        resolved_at=row["resolved_at"],
    )


class PostgresStorage(OddsStorage):
    name: ClassVar[str] = "postgres"

    def __init__(self, dsn: str):
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None

    @classmethod
    def from_env(cls) -> "PostgresStorage":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is required for ODDS_STORAGE=postgres")
        return cls(dsn=dsn)

    async def __aenter__(self) -> "PostgresStorage":
        self._pool = await asyncpg.create_pool(
            dsn=self._dsn,
            min_size=1,
            max_size=4,
        )
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def init_schema(self) -> None:
        assert self._pool is not None, "init_schema called outside async-with"
        async with self._pool.acquire() as conn:
            for stmt in _SCHEMA_STATEMENTS:
                await conn.execute(stmt)
        logger.info("Postgres odds schema ready")

    async def record(self, event: CanonicalEvent) -> None:
        assert self._pool is not None, "record called outside async-with"
        projected = h2h_odds(event)
        home_odds, away_odds, draw_odds = (
            projected if projected is not None else (0.0, 0.0, 0.0)
        )
        markets_json = json.dumps([m.model_dump() for m in event.markets])
        current_args = (
            event.event_id,
            event.origin,
            event.sport,
            event.home_team,
            event.away_team,
            home_odds,
            away_odds,
            draw_odds,
            markets_json,
            event.commence_time,
            event.updated_at,
        )
        history_args = (
            event.event_id,
            event.sport,
            event.home_team,
            event.away_team,
            home_odds,
            away_odds,
            draw_odds,
            markets_json,
            event.updated_at,
        )
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(_INSERT_HISTORY, *history_args)
                await conn.execute(_UPSERT_CURRENT, *current_args)
                await conn.execute(
                    _UPSERT_SOURCE_MAP,
                    event.origin,
                    event.source_event_id,
                    event.event_id,
                    event.sport,
                    event.updated_at,
                )

    async def record_result(self, result: EventResult) -> None:
        assert self._pool is not None, "record_result called outside async-with"
        async with self._pool.acquire() as conn:
            await conn.execute(
                _UPSERT_RESULT,
                result.event_id,
                result.sport,
                result.outcome,
                result.resolved_at,
            )

    async def list_current(self, sport: str | None = None) -> list[CanonicalEvent]:
        assert self._pool is not None, "list_current called outside async-with"
        async with self._pool.acquire() as conn:
            if sport is not None:
                rows = await conn.fetch(_SELECT_BY_SPORT, sport)
            else:
                rows = await conn.fetch(_SELECT_ALL)
        return [_row_to_event(r) for r in rows]

    async def get_current(self, event_id: str) -> CanonicalEvent | None:
        assert self._pool is not None, "get_current called outside async-with"
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(_SELECT_BY_EVENT, event_id)
        return _row_to_event(row) if row is not None else None
