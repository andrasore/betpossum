import os
from contextlib import AsyncExitStack
from typing import Annotated

from fastapi import Depends

from . import get_storage
from .base import OddsStorage

STORAGE_NAME = os.environ.get("ODDS_STORAGE", "postgres")

_storage: OddsStorage | None = None
_stack: AsyncExitStack | None = None


async def open_storage() -> OddsStorage:
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


async def get_odds_storage() -> OddsStorage:
    assert _storage is not None, "storage requested before startup"
    return _storage


StorageDep = Annotated[OddsStorage, Depends(get_odds_storage)]
