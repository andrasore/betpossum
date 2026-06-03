"""Shared fixtures: a real Postgres (testcontainers) behind PostgresStorage.

The container is started once per session; each test gets a pristine schema so
storage tests stay isolated without paying the container-boot cost per test.
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
        # asyncpg is the driver PostgresStorage runs on; the container's own
        # readiness check shells out to psql, so no host driver is needed.
        yield container.get_connection_url(driver="asyncpg")


@pytest_asyncio.fixture
async def storage(postgres_dsn: str) -> AsyncIterator[PostgresStorage]:
    async with PostgresStorage(postgres_dsn) as store:
        assert store._engine is not None
        async with store._engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.drop_all)
        await store.init_schema()
        yield store
