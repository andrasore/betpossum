import logging
import os
from typing import ClassVar

import asyncpg

from models import OddsEvent
from .base import OddsStorage

logger = logging.getLogger(__name__)

_SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS odds_current (
      event_id   TEXT PRIMARY KEY,
      sport      TEXT NOT NULL,
      home_team  TEXT NOT NULL,
      away_team  TEXT NOT NULL,
      home_odds  DOUBLE PRECISION NOT NULL,
      away_odds  DOUBLE PRECISION NOT NULL,
      draw_odds  DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    )
    """,
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
      updated_at BIGINT NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_history_event_time
      ON odds_history (event_id, updated_at DESC)
    """,
]

_INSERT_HISTORY = """
INSERT INTO odds_history
  (event_id, sport, home_team, away_team, home_odds, away_odds, draw_odds, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
"""

_UPSERT_CURRENT = """
INSERT INTO odds_current
  (event_id, sport, home_team, away_team, home_odds, away_odds, draw_odds, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (event_id) DO UPDATE SET
  sport      = EXCLUDED.sport,
  home_team  = EXCLUDED.home_team,
  away_team  = EXCLUDED.away_team,
  home_odds  = EXCLUDED.home_odds,
  away_odds  = EXCLUDED.away_odds,
  draw_odds  = EXCLUDED.draw_odds,
  updated_at = EXCLUDED.updated_at
"""


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
        self._pool = await asyncpg.create_pool(dsn=self._dsn, min_size=1, max_size=4)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def init_schema(self) -> None:
        assert self._pool is not None, "init_schema called outside async-with"
        async with self._pool.acquire() as conn:
            for stmt in _SCHEMA_STATEMENTS:
                await conn.execute(stmt)
        logger.info("Postgres odds schema ready")

    async def record(self, event: OddsEvent) -> None:
        assert self._pool is not None, "record called outside async-with"
        args = (
            event.event_id,
            event.sport,
            event.home_team,
            event.away_team,
            event.home_odds,
            event.away_odds,
            event.draw_odds,
            event.updated_at,
        )
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(_INSERT_HISTORY, *args)
                await conn.execute(_UPSERT_CURRENT, *args)
