"""Shared fixtures: a real Postgres (testcontainers) behind PostgresStorage.

The container boots once per session; each test gets a pristine schema so the
storage tests stay isolated without paying the boot cost per test.
"""

from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from sqlmodel import SQLModel
from testcontainers.postgres import PostgresContainer

from storage.postgres import PostgresStorage


@pytest.fixture(scope="session")
def postgres_dsn() -> Iterator[str]:
    with PostgresContainer("postgres:16-alpine") as container:
        yield container.get_connection_url(driver="asyncpg")


@pytest_asyncio.fixture
async def store(postgres_dsn: str) -> AsyncIterator[PostgresStorage]:
    async with PostgresStorage(postgres_dsn) as s:
        assert s._engine is not None
        async with s._engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.drop_all)
        await s.init_schema()
        yield s
