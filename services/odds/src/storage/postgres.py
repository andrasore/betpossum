import logging
import os
from types import TracebackType
from typing import Any, ClassVar, cast

from sqlalchemy import BigInteger, Double, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlmodel import Column, Field, SQLModel, col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from odds.models import CanonicalEvent, EventResult, Market, Outcome, h2h_odds

from .base import OddsStorage

logger = logging.getLogger(__name__)


# ── Table models ───────────────────────────────────────────────────────────

class OddsCurrent(SQLModel, table=True):
    # SQLAlchemy types __tablename__ as declared_attr; a plain str is correct
    # at runtime but pyright flags the assignment.
    __tablename__ = "odds_current"  # pyright: ignore[reportAssignmentType]

    event_id: str = Field(sa_column=Column(Text, primary_key=True))
    origin: str = Field(
        default="", sa_column=Column(Text, nullable=False, server_default="")
    )
    sport: str = Field(sa_column=Column(Text, nullable=False))
    home_team: str = Field(sa_column=Column(Text, nullable=False))
    away_team: str = Field(sa_column=Column(Text, nullable=False))
    home_odds: float = Field(sa_column=Column(Double, nullable=False))
    away_odds: float = Field(sa_column=Column(Double, nullable=False))
    draw_odds: float = Field(
        default=0.0, sa_column=Column(Double, nullable=False, server_default=text("0"))
    )
    markets: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'")),
    )
    commence_time: int | None = Field(default=None, sa_column=Column(BigInteger))
    updated_at: int = Field(sa_column=Column(BigInteger, nullable=False))
    outcome: str | None = Field(default=None, sa_column=Column(Text))
    resolved_at: int | None = Field(default=None, sa_column=Column(BigInteger))


class OddsHistory(SQLModel, table=True):
    __tablename__ = "odds_history"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (
        Index("idx_history_event_time", "event_id", text("updated_at DESC")),
    )

    id: int | None = Field(
        default=None,
        sa_column=Column(BigInteger, primary_key=True, autoincrement=True),
    )
    event_id: str = Field(sa_column=Column(Text, nullable=False))
    sport: str = Field(sa_column=Column(Text, nullable=False))
    home_team: str = Field(sa_column=Column(Text, nullable=False))
    away_team: str = Field(sa_column=Column(Text, nullable=False))
    home_odds: float = Field(sa_column=Column(Double, nullable=False))
    away_odds: float = Field(sa_column=Column(Double, nullable=False))
    draw_odds: float = Field(
        default=0.0, sa_column=Column(Double, nullable=False, server_default=text("0"))
    )
    markets: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default=text("'[]'")),
    )
    updated_at: int = Field(sa_column=Column(BigInteger, nullable=False))


class EventSourceMap(SQLModel, table=True):
    __tablename__ = "event_source_map"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (Index("idx_source_map_canonical", "canonical_event_id"),)

    provider: str = Field(sa_column=Column(Text, primary_key=True))
    source_event_id: str = Field(sa_column=Column(Text, primary_key=True))
    canonical_event_id: str = Field(sa_column=Column(Text, nullable=False))
    source_sport: str | None = Field(default=None, sa_column=Column(Text))
    updated_at: int = Field(sa_column=Column(BigInteger, nullable=False))


# Columns refreshed on an odds_current conflict (everything but the PK).
_CURRENT_UPDATE_COLS = [
    "origin",
    "sport",
    "home_team",
    "away_team",
    "home_odds",
    "away_odds",
    "draw_odds",
    "markets",
    "commence_time",
    "updated_at",
]


def _async_dsn(dsn: str) -> str:
    """Point SQLAlchemy at the asyncpg driver regardless of the URL scheme."""
    for scheme in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if dsn.startswith(scheme):
            return "postgresql+asyncpg://" + dsn[len(scheme) :]
    return dsn


def _to_event(row: OddsCurrent) -> CanonicalEvent:
    markets = [Market.model_validate(m) for m in row.markets]
    return CanonicalEvent(
        event_id=row.event_id,
        origin=row.origin,
        source_event_id=row.event_id.split(":", 1)[-1],
        sport=row.sport,
        home_team=row.home_team,
        away_team=row.away_team,
        commence_time=row.commence_time,
        markets=markets,
        updated_at=row.updated_at,
        outcome=cast(Outcome | None, row.outcome),
        resolved_at=row.resolved_at,
    )


class PostgresStorage(OddsStorage):
    name: ClassVar[str] = "postgres"

    def __init__(self, dsn: str):
        self._dsn = _async_dsn(dsn)
        self._engine: AsyncEngine | None = None
        self._session: async_sessionmaker[AsyncSession] | None = None

    @classmethod
    def from_env(cls) -> "PostgresStorage":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is required for ODDS_STORAGE=postgres")
        return cls(dsn=dsn)

    async def __aenter__(self) -> "PostgresStorage":
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
        assert self._engine is not None, "init_schema called outside async-with"
        async with self._engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        logger.info("Postgres odds schema ready")

    async def record(self, event: CanonicalEvent) -> None:
        assert self._engine is not None, "record called outside async-with"
        projected = h2h_odds(event)
        home_odds, away_odds, draw_odds = (
            projected if projected is not None else (0.0, 0.0, 0.0)
        )
        markets = [m.model_dump() for m in event.markets]

        history = pg_insert(OddsHistory).values(
            event_id=event.event_id,
            sport=event.sport,
            home_team=event.home_team,
            away_team=event.away_team,
            home_odds=home_odds,
            away_odds=away_odds,
            draw_odds=draw_odds,
            markets=markets,
            updated_at=event.updated_at,
        )

        current = pg_insert(OddsCurrent).values(
            event_id=event.event_id,
            origin=event.origin,
            sport=event.sport,
            home_team=event.home_team,
            away_team=event.away_team,
            home_odds=home_odds,
            away_odds=away_odds,
            draw_odds=draw_odds,
            markets=markets,
            commence_time=event.commence_time,
            updated_at=event.updated_at,
        )
        current = current.on_conflict_do_update(
            index_elements=["event_id"],
            set_={c: current.excluded[c] for c in _CURRENT_UPDATE_COLS},
        )

        source_map = pg_insert(EventSourceMap).values(
            provider=event.origin,
            source_event_id=event.source_event_id,
            canonical_event_id=event.event_id,
            source_sport=event.sport,
            updated_at=event.updated_at,
        )
        source_map = source_map.on_conflict_do_update(
            index_elements=["provider", "source_event_id"],
            set_={
                "canonical_event_id": source_map.excluded["canonical_event_id"],
                "source_sport": source_map.excluded["source_sport"],
                "updated_at": source_map.excluded["updated_at"],
            },
        )

        # One transaction for the history append + both upserts. ON CONFLICT is a
        # Core construct, so these run on the connection rather than via the
        # ORM session (whose async `execute` SQLModel deprecates).
        async with self._engine.begin() as conn:
            await conn.execute(history)
            await conn.execute(current)
            await conn.execute(source_map)

    async def record_result(self, result: EventResult) -> None:
        assert self._engine is not None, "record_result called outside async-with"
        # An admin-driven resolution can only target a mock-origin event that
        # already exists (the route enforces both), but keep the upsert
        # defensive: a bare row can only originate from mock.
        stmt = pg_insert(OddsCurrent).values(
            event_id=result.event_id,
            origin="mock",
            sport=result.sport,
            home_team="",
            away_team="",
            home_odds=0.0,
            away_odds=0.0,
            draw_odds=0.0,
            markets=[],
            updated_at=0,
            outcome=result.outcome,
            resolved_at=result.resolved_at,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["event_id"],
            set_={
                "outcome": stmt.excluded["outcome"],
                "resolved_at": stmt.excluded["resolved_at"],
            },
        )
        async with self._engine.begin() as conn:
            await conn.execute(stmt)

    async def list_current(self, sport: str | None = None) -> list[CanonicalEvent]:
        assert self._session is not None, "list_current called outside async-with"
        stmt = select(OddsCurrent).order_by(col(OddsCurrent.updated_at).desc())
        if sport is not None:
            stmt = stmt.where(col(OddsCurrent.sport) == sport)
        async with self._session() as session:
            rows = (await session.exec(stmt)).all()
        return [_to_event(r) for r in rows]

    async def get_current(self, event_id: str) -> CanonicalEvent | None:
        assert self._session is not None, "get_current called outside async-with"
        stmt = select(OddsCurrent).where(col(OddsCurrent.event_id) == event_id)
        async with self._session() as session:
            row = (await session.exec(stmt)).first()
        return _to_event(row) if row is not None else None
