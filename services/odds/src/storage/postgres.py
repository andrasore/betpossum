import logging
import os
from collections.abc import Sequence
from types import TracebackType
from typing import Any, ClassVar, cast

from sqlalchemy import BigInteger, Double, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import Column, Field, SQLModel, col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from odds.models import (
    CanonicalEvent,
    CanonicalLeague,
    CanonicalSport,
    EventResult,
    Market,
    Outcome,
    h2h_odds,
)
from odds.normalize import (
    league_match_key,
    slugify_sport,
    sport_title,
    team_match_key,
)

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
    # Canonical entity links resolved at ingest; nullable so a resolution miss
    # never blocks recording the odds.
    sport_slug: str | None = Field(default=None, sa_column=Column(Text))
    league_id: int | None = Field(default=None, sa_column=Column(BigInteger))
    home_team_id: int | None = Field(default=None, sa_column=Column(BigInteger))
    away_team_id: int | None = Field(default=None, sa_column=Column(BigInteger))


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
    sport_slug: str | None = Field(default=None, sa_column=Column(Text))
    league_id: int | None = Field(default=None, sa_column=Column(BigInteger))
    home_team_id: int | None = Field(default=None, sa_column=Column(BigInteger))
    away_team_id: int | None = Field(default=None, sa_column=Column(BigInteger))


class EventSourceMap(SQLModel, table=True):
    __tablename__ = "event_source_map"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (Index("idx_source_map_canonical", "canonical_event_id"),)

    provider: str = Field(sa_column=Column(Text, primary_key=True))
    source_event_id: str = Field(sa_column=Column(Text, primary_key=True))
    canonical_event_id: str = Field(sa_column=Column(Text, nullable=False))
    source_sport: str | None = Field(default=None, sa_column=Column(Text))
    updated_at: int = Field(sa_column=Column(BigInteger, nullable=False))


# ── Canonical reference entities + per-provider source maps ──────────────────
#
# Same shape as `event_source_map`: a provider-agnostic canonical row plus a
# `(provider, source_key) -> canonical_id` map. Two providers whose labels
# reduce to the same match key (`odds.normalize`) converge onto one canonical
# row — that is the cross-provider merge. `match_key` is unique *within a sport*
# so a name collision across sports can't merge two entities. Country is
# enrichment, not part of the match.


class Sport(SQLModel, table=True):
    __tablename__ = "sport"  # pyright: ignore[reportAssignmentType]

    slug: str = Field(sa_column=Column(Text, primary_key=True))
    title: str = Field(sa_column=Column(Text, nullable=False))


class League(SQLModel, table=True):
    __tablename__ = "league"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (
        Index("uq_league_sport_match", "sport_slug", "match_key", unique=True),
    )

    id: int | None = Field(
        default=None, sa_column=Column(BigInteger, primary_key=True, autoincrement=True)
    )
    sport_slug: str = Field(sa_column=Column(Text, nullable=False))
    name: str = Field(sa_column=Column(Text, nullable=False))
    match_key: str = Field(sa_column=Column(Text, nullable=False))
    country: str | None = Field(default=None, sa_column=Column(Text))


class Team(SQLModel, table=True):
    __tablename__ = "team"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (
        Index("uq_team_sport_match", "sport_slug", "match_key", unique=True),
    )

    id: int | None = Field(
        default=None, sa_column=Column(BigInteger, primary_key=True, autoincrement=True)
    )
    sport_slug: str = Field(sa_column=Column(Text, nullable=False))
    name: str = Field(sa_column=Column(Text, nullable=False))
    match_key: str = Field(sa_column=Column(Text, nullable=False))
    country: str | None = Field(default=None, sa_column=Column(Text))


class SportSourceMap(SQLModel, table=True):
    __tablename__ = "sport_source_map"  # pyright: ignore[reportAssignmentType]

    provider: str = Field(sa_column=Column(Text, primary_key=True))
    source_key: str = Field(sa_column=Column(Text, primary_key=True))
    sport_slug: str = Field(sa_column=Column(Text, nullable=False))
    updated_at: int = Field(sa_column=Column(BigInteger, nullable=False))


class LeagueSourceMap(SQLModel, table=True):
    __tablename__ = "league_source_map"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (Index("idx_league_source_canonical", "league_id"),)

    provider: str = Field(sa_column=Column(Text, primary_key=True))
    source_key: str = Field(sa_column=Column(Text, primary_key=True))
    league_id: int = Field(sa_column=Column(BigInteger, nullable=False))
    source_name: str | None = Field(default=None, sa_column=Column(Text))
    source_country: str | None = Field(default=None, sa_column=Column(Text))
    updated_at: int = Field(sa_column=Column(BigInteger, nullable=False))


class TeamSourceMap(SQLModel, table=True):
    __tablename__ = "team_source_map"  # pyright: ignore[reportAssignmentType]
    __table_args__ = (Index("idx_team_source_canonical", "team_id"),)

    provider: str = Field(sa_column=Column(Text, primary_key=True))
    source_key: str = Field(sa_column=Column(Text, primary_key=True))
    team_id: int = Field(sa_column=Column(BigInteger, nullable=False))
    source_name: str | None = Field(default=None, sa_column=Column(Text))
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
    "sport_slug",
    "league_id",
    "home_team_id",
    "away_team_id",
]


def _async_dsn(dsn: str) -> str:
    """Point SQLAlchemy at the asyncpg driver regardless of the URL scheme."""
    for scheme in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if dsn.startswith(scheme):
            return "postgresql+asyncpg://" + dsn[len(scheme) :]
    return dsn


def _to_event(
    row: OddsCurrent,
    sport_title: str | None = None,
    league_name: str | None = None,
    home_team_name: str | None = None,
    away_team_name: str | None = None,
) -> CanonicalEvent:
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
        # Canonical display names from the entity join (None when unlinked).
        sport_title=sport_title,
        league_id=row.league_id,
        league_name=league_name,
        home_team_name=home_team_name,
        away_team_name=away_team_name,
    )


class PostgresStorage(OddsStorage):
    name: ClassVar[str] = "postgres"

    def __init__(self, dsn: str, schema: str | None = None):
        self._dsn = _async_dsn(dsn)
        # Tables live in this Postgres schema of the shared `betting` DB; None
        # (tests) leaves the default `public` search_path untouched.
        self._schema = schema
        self._engine: AsyncEngine | None = None
        self._session: async_sessionmaker[AsyncSession] | None = None

    @classmethod
    def from_env(cls) -> "PostgresStorage":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is required for ODDS_STORAGE=postgres")
        return cls(dsn=dsn, schema=os.environ.get("DB_SCHEMA") or None)

    async def __aenter__(self) -> "PostgresStorage":
        connect_args = (
            {"server_settings": {"search_path": self._schema}} if self._schema else {}
        )
        self._engine = create_async_engine(
            self._dsn, pool_size=4, max_overflow=0, connect_args=connect_args
        )
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
            if self._schema:
                # infra's init.sql already creates it; idempotent self-provision
                # keeps the search_path target present even on a bare DB.
                await conn.execute(
                    text(f'CREATE SCHEMA IF NOT EXISTS "{self._schema}"')
                )
            await conn.run_sync(SQLModel.metadata.create_all)
            # `create_all` adds missing tables but never alters an existing one,
            # so bridge the new entity-link columns on already-deployed
            # odds_current/odds_history (Postgres `IF NOT EXISTS` is idempotent).
            for table_name in ("odds_current", "odds_history"):
                for column, col_type in (
                    ("sport_slug", "text"),
                    ("league_id", "bigint"),
                    ("home_team_id", "bigint"),
                    ("away_team_id", "bigint"),
                ):
                    await conn.execute(
                        text(
                            f"ALTER TABLE {table_name} "
                            f"ADD COLUMN IF NOT EXISTS {column} {col_type}"
                        )
                    )
        logger.info("Postgres odds schema ready")

    async def _resolve_sport(self, conn: AsyncConnection, event: CanonicalEvent) -> str:
        slug = slugify_sport(event.sport, event.sport_group)
        await conn.execute(
            pg_insert(Sport)
            .values(slug=slug, title=sport_title(slug))
            .on_conflict_do_nothing(index_elements=["slug"])
        )
        sport_map = pg_insert(SportSourceMap).values(
            provider=event.origin,
            source_key=event.sport,
            sport_slug=slug,
            updated_at=event.updated_at,
        )
        await conn.execute(
            sport_map.on_conflict_do_update(
                index_elements=["provider", "source_key"],
                set_={
                    "sport_slug": sport_map.excluded["sport_slug"],
                    "updated_at": sport_map.excluded["updated_at"],
                },
            )
        )
        return slug

    async def _resolve_league(
        self, conn: AsyncConnection, event: CanonicalEvent, sport_slug: str
    ) -> int | None:
        if not event.league_key or not event.league_name:
            return None
        match_key = league_match_key(event.league_name)
        league_ins = pg_insert(League).values(
            sport_slug=sport_slug,
            name=event.league_name,
            match_key=match_key,
            country=event.country,
        )
        # Keep the first-seen name; only backfill a country we didn't have. The
        # DO UPDATE (vs DO NOTHING) is what makes RETURNING yield the existing
        # row's id on conflict.
        league_ins = league_ins.on_conflict_do_update(
            index_elements=["sport_slug", "match_key"],
            set_={
                "country": func.coalesce(
                    col(League.country), league_ins.excluded["country"]
                )
            },
        ).returning(col(League.id))
        league_id = (await conn.execute(league_ins)).scalar_one()

        league_map = pg_insert(LeagueSourceMap).values(
            provider=event.origin,
            source_key=event.league_key,
            league_id=league_id,
            source_name=event.league_name,
            source_country=event.country,
            updated_at=event.updated_at,
        )
        await conn.execute(
            league_map.on_conflict_do_update(
                index_elements=["provider", "source_key"],
                set_={
                    "league_id": league_map.excluded["league_id"],
                    "source_name": league_map.excluded["source_name"],
                    "source_country": league_map.excluded["source_country"],
                    "updated_at": league_map.excluded["updated_at"],
                },
            )
        )
        return league_id

    async def _resolve_team(
        self,
        conn: AsyncConnection,
        event: CanonicalEvent,
        sport_slug: str,
        name: str,
        source_key: str | None,
    ) -> int | None:
        if not name:
            return None
        match_key = team_match_key(name)
        # A provider without team ids (The Odds API) keys its source map by the
        # match key, so its rows still collapse onto the shared canonical team.
        source_key = source_key or match_key
        team_ins = pg_insert(Team).values(
            sport_slug=sport_slug,
            name=name,
            match_key=match_key,
            country=event.country,
        )
        team_ins = team_ins.on_conflict_do_update(
            index_elements=["sport_slug", "match_key"],
            set_={
                "country": func.coalesce(
                    col(Team.country), team_ins.excluded["country"]
                )
            },
        ).returning(col(Team.id))
        team_id = (await conn.execute(team_ins)).scalar_one()

        team_map = pg_insert(TeamSourceMap).values(
            provider=event.origin,
            source_key=source_key,
            team_id=team_id,
            source_name=name,
            updated_at=event.updated_at,
        )
        await conn.execute(
            team_map.on_conflict_do_update(
                index_elements=["provider", "source_key"],
                set_={
                    "team_id": team_map.excluded["team_id"],
                    "source_name": team_map.excluded["source_name"],
                    "updated_at": team_map.excluded["updated_at"],
                },
            )
        )
        return team_id

    async def record(self, event: CanonicalEvent) -> None:
        assert self._engine is not None, "record called outside async-with"
        projected = h2h_odds(event)
        home_odds, away_odds, draw_odds = (
            projected if projected is not None else (0.0, 0.0, 0.0)
        )
        markets = [m.model_dump() for m in event.markets]

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

        # One transaction: resolve the canonical sport/league/team links, append
        # history, then upsert current + the event source map. ON CONFLICT is a
        # Core construct, so these run on the connection rather than via the ORM
        # session (whose async `execute` SQLModel deprecates).
        async with self._engine.begin() as conn:
            sport_slug = await self._resolve_sport(conn, event)
            league_id = await self._resolve_league(conn, event, sport_slug)
            home_team_id = await self._resolve_team(
                conn, event, sport_slug, event.home_team, event.home_team_key
            )
            away_team_id = await self._resolve_team(
                conn, event, sport_slug, event.away_team, event.away_team_key
            )
            entity_cols: dict[str, Any] = {
                "sport_slug": sport_slug,
                "league_id": league_id,
                "home_team_id": home_team_id,
                "away_team_id": away_team_id,
            }

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
                **entity_cols,
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
                **entity_cols,
            )
            current = current.on_conflict_do_update(
                index_elements=["event_id"],
                set_={c: current.excluded[c] for c in _CURRENT_UPDATE_COLS},
            )

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

    async def _hydrate_names(
        self, session: AsyncSession, rows: Sequence[OddsCurrent]
    ) -> list[CanonicalEvent]:
        """Attach canonical sport/league/team display names to odds rows.

        Resolves the entity links via a few set-based lookups against the small
        reference tables (rather than a multi-entity join, which SQLModel types
        poorly). A missing link just leaves its name None — the caller falls
        back to the raw provider label.
        """
        sport_slugs = {r.sport_slug for r in rows if r.sport_slug is not None}
        league_ids = {r.league_id for r in rows if r.league_id is not None}
        team_ids = {
            tid
            for r in rows
            for tid in (r.home_team_id, r.away_team_id)
            if tid is not None
        }

        sport_titles: dict[str, str] = {}
        if sport_slugs:
            res = await session.exec(
                select(Sport).where(col(Sport.slug).in_(sport_slugs))
            )
            sport_titles = {s.slug: s.title for s in res.all()}

        league_names: dict[int, str] = {}
        if league_ids:
            res = await session.exec(
                select(League).where(col(League.id).in_(league_ids))
            )
            league_names = {lg.id: lg.name for lg in res.all() if lg.id is not None}

        team_names: dict[int, str] = {}
        if team_ids:
            res = await session.exec(select(Team).where(col(Team.id).in_(team_ids)))
            team_names = {t.id: t.name for t in res.all() if t.id is not None}

        return [
            _to_event(
                r,
                sport_title=sport_titles.get(r.sport_slug) if r.sport_slug else None,
                league_name=league_names.get(r.league_id) if r.league_id else None,
                home_team_name=(
                    team_names.get(r.home_team_id) if r.home_team_id else None
                ),
                away_team_name=(
                    team_names.get(r.away_team_id) if r.away_team_id else None
                ),
            )
            for r in rows
        ]

    async def list_current(
        self, sport: str | None = None, league: int | None = None
    ) -> list[CanonicalEvent]:
        assert self._session is not None, "list_current called outside async-with"
        stmt = select(OddsCurrent).order_by(col(OddsCurrent.updated_at).desc())
        if sport is not None:
            # Filter on the canonical sport slug (what GET /odds/sports exposes),
            # not the raw provider label, so one chip spans every provider league.
            stmt = stmt.where(col(OddsCurrent.sport_slug) == sport)
        if league is not None:
            # The canonical league id (GET /odds/leagues) is globally unique, so
            # it pins the league on its own — the sport filter above is redundant
            # but kept (the UI sends both since a league implies its sport).
            stmt = stmt.where(col(OddsCurrent.league_id) == league)
        async with self._session() as session:
            rows = (await session.exec(stmt)).all()
            return await self._hydrate_names(session, rows)

    async def get_current(self, event_id: str) -> CanonicalEvent | None:
        assert self._session is not None, "get_current called outside async-with"
        stmt = select(OddsCurrent).where(col(OddsCurrent.event_id) == event_id)
        async with self._session() as session:
            row = (await session.exec(stmt)).first()
            if row is None:
                return None
            events = await self._hydrate_names(session, [row])
        return events[0]

    async def list_sports(self) -> list[CanonicalSport]:
        assert self._session is not None, "list_sports called outside async-with"
        # The canonical `sport` table is already de-duplicated across providers,
        # so it's the right source for the filter chips (it also lists sports
        # that have no current events).
        stmt = select(Sport).order_by(col(Sport.title))
        async with self._session() as session:
            rows = (await session.exec(stmt)).all()
        return [CanonicalSport(slug=s.slug, title=s.title) for s in rows]

    async def list_leagues(self, sport: str | None = None) -> list[CanonicalLeague]:
        assert self._session is not None, "list_leagues called outside async-with"
        # The canonical `league` table is de-duplicated across providers, like
        # `sport`. Optionally scoped to one sport (the league bar shows the
        # selected sport's leagues; unscoped lists every sport's leagues).
        stmt = select(League).order_by(col(League.name))
        if sport is not None:
            stmt = stmt.where(col(League.sport_slug) == sport)
        async with self._session() as session:
            rows = (await session.exec(stmt)).all()
        return [
            CanonicalLeague(id=lg.id, name=lg.name, sport_slug=lg.sport_slug)
            for lg in rows
            if lg.id is not None
        ]
