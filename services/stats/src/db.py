"""Postgres read store for the stats projection.

Owns a single table, ``stats_settlements`` — one row per settled bet, keyed by
``bet_id`` so redelivery of the durable ``bets.settled`` event is idempotent
(ON CONFLICT DO NOTHING). Nothing here reads Core's or Odds' tables; the event
is the only input.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from types import TracebackType
from typing import ClassVar

from sqlalchemy import BigInteger, Integer, Text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlmodel import Column, Field, SQLModel, col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from aggregate import SettlementRow


class Settlement(SQLModel, table=True):
    __tablename__ = "stats_settlements"  # pyright: ignore[reportAssignmentType]

    bet_id: str = Field(sa_column=Column(Text, primary_key=True))
    user_id: str = Field(sa_column=Column(Text, nullable=False, index=True))
    user_name: str | None = Field(default=None, sa_column=Column(Text))
    settled_at: int = Field(sa_column=Column(BigInteger, nullable=False))
    stake_cents: int = Field(sa_column=Column(Integer, nullable=False))
    # Signed: +profit on a win, -stake on a loss.
    profit_cents: int = Field(sa_column=Column(Integer, nullable=False))


@dataclass(frozen=True)
class LeaderboardEntry:
    userId: str
    userName: str | None
    roiPct: float
    netProfit: float
    settledCount: int


def _async_dsn(dsn: str) -> str:
    """Point SQLAlchemy at the asyncpg driver regardless of the URL scheme."""
    for scheme in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if dsn.startswith(scheme):
            return "postgresql+asyncpg://" + dsn[len(scheme) :]
    return dsn


class StatsStore:
    name: ClassVar[str] = "postgres"

    def __init__(self, dsn: str):
        self._dsn = _async_dsn(dsn)
        self._engine: AsyncEngine | None = None
        self._session: async_sessionmaker[AsyncSession] | None = None

    @classmethod
    def from_env(cls) -> StatsStore:
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is required")
        return cls(dsn=dsn)

    async def __aenter__(self) -> StatsStore:
        self._engine = create_async_engine(self._dsn, pool_size=4, max_overflow=0)
        self._session = async_sessionmaker(
            self._engine, class_=AsyncSession, expire_on_commit=False
        )
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._engine is not None:
            await self._engine.dispose()
            self._engine = self._session = None

    async def init_schema(self) -> None:
        assert self._engine is not None
        async with self._engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        assert self._session is not None, "store used before startup"
        return self._session

    async def record_settlement(
        self,
        *,
        bet_id: str,
        user_id: str,
        user_name: str | None,
        settled_at: int,
        stake_cents: int,
        profit_cents: int,
    ) -> None:
        """Upsert a settlement; a duplicate bet_id is a no-op (exactly-once)."""
        stmt = (
            pg_insert(Settlement)
            .values(
                bet_id=bet_id,
                user_id=user_id,
                user_name=user_name,
                settled_at=settled_at,
                stake_cents=stake_cents,
                profit_cents=profit_cents,
            )
            .on_conflict_do_nothing(index_elements=["bet_id"])
        )
        async with self._sessions()() as session:
            await session.exec(stmt)  # pyright: ignore[reportCallIssue, reportUnknownMemberType]
            await session.commit()

    async def user_rows(self, user_id: str) -> list[SettlementRow]:
        stmt = (
            select(Settlement)
            .where(col(Settlement.user_id) == user_id)
            .order_by(col(Settlement.settled_at))
        )
        async with self._sessions()() as session:
            rows = (await session.exec(stmt)).all()
        return [
            SettlementRow(
                settled_at=r.settled_at,
                stake_cents=r.stake_cents,
                profit_cents=r.profit_cents,
            )
            for r in rows
        ]

    async def leaderboard(
        self, *, min_settled: int, limit: int
    ) -> list[LeaderboardEntry]:
        # Demo scale: read the settlements and aggregate per user in process.
        # Keeps the query fully typed (a plain `select(Settlement)`); a GROUP BY
        # over a mix of mapped columns and aggregate funcs defeats the typed
        # query builder.
        async with self._sessions()() as session:
            rows = (await session.exec(select(Settlement))).all()

        agg: dict[str, _UserAgg] = {}
        for r in rows:
            a = agg.setdefault(r.user_id, _UserAgg(name=r.user_name))
            a.stake_cents += r.stake_cents
            a.profit_cents += r.profit_cents
            a.count += 1
            if a.name is None:
                a.name = r.user_name

        entries = [
            LeaderboardEntry(
                userId=user_id,
                userName=a.name,
                roiPct=round(a.profit_cents / a.stake_cents * 100, 2)
                if a.stake_cents > 0
                else 0.0,
                netProfit=round(a.profit_cents / 100, 2),
                settledCount=a.count,
            )
            for user_id, a in agg.items()
            if a.count >= min_settled
        ]
        entries.sort(key=lambda e: e.roiPct, reverse=True)
        return entries[:limit]


@dataclass
class _UserAgg:
    name: str | None
    stake_cents: int = 0
    profit_cents: int = 0
    count: int = 0
