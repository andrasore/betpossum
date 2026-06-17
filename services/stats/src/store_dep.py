"""Process-global StatsStore lifecycle + FastAPI dependency.

Kept out of routes.py and app.py so both the HTTP layer and the consumer share
one store instance without an import cycle (mirrors odds' storage.dependencies).
"""

from contextlib import AsyncExitStack
from typing import Annotated

from fastapi import Depends

from db import StatsStore

_store: StatsStore | None = None
_stack: AsyncExitStack | None = None


async def open_store() -> StatsStore:
    global _store, _stack
    stack = AsyncExitStack()
    store = await stack.enter_async_context(StatsStore.from_env())
    await store.init_schema()
    _store, _stack = store, stack
    return store


async def close_store() -> None:
    global _store, _stack
    if _stack is not None:
        await _stack.aclose()
    _store = _stack = None


def get_store() -> StatsStore:
    assert _store is not None, "store requested before startup"
    return _store


StoreDep = Annotated[StatsStore, Depends(get_store)]
