"""Process-global StatsStorage lifecycle + FastAPI dependency.

Kept out of routes.py and app.py so both the HTTP layer and the consumer share
one storage instance without an import cycle (mirrors odds' storage.dependencies).
"""

import os
from contextlib import AsyncExitStack
from typing import Annotated

from fastapi import Depends

from . import get_storage
from .base import StatsStorage

STORAGE_NAME = os.environ.get("STATS_STORAGE", "postgres")

_storage: StatsStorage | None = None
_stack: AsyncExitStack | None = None


async def open_storage() -> StatsStorage:
    global _storage, _stack
    stack = AsyncExitStack()
    storage = await stack.enter_async_context(get_storage(STORAGE_NAME))
    await storage.init_schema()
    _storage, _stack = storage, stack
    return storage


async def close_storage() -> None:
    global _storage, _stack
    if _stack is not None:
        await _stack.aclose()
    _storage = _stack = None


def get_stats_storage() -> StatsStorage:
    assert _storage is not None, "storage requested before startup"
    return _storage


StorageDep = Annotated[StatsStorage, Depends(get_stats_storage)]
