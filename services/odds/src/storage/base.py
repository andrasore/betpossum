from __future__ import annotations

from abc import ABC, abstractmethod
from types import TracebackType
from typing import TYPE_CHECKING, ClassVar

if TYPE_CHECKING:
    # Only needed for the abstract signatures below; importing at runtime would
    # create a storage -> odds -> routes -> storage.dependencies import cycle.
    from odds.models import (
        CanonicalEvent,
        CanonicalLeague,
        CanonicalSport,
        EventResult,
    )


class OddsStorage(ABC):
    name: ClassVar[str]

    @classmethod
    @abstractmethod
    def from_env(cls) -> "OddsStorage": ...

    async def __aenter__(self) -> "OddsStorage":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def init_schema(self) -> None:
        return None

    @abstractmethod
    async def record(self, event: CanonicalEvent) -> None: ...

    @abstractmethod
    async def record_result(self, result: EventResult) -> None: ...

    @abstractmethod
    async def list_current(
        self, sport: str | None = None, league: int | None = None
    ) -> list[CanonicalEvent]: ...

    @abstractmethod
    async def get_current(self, event_id: str) -> CanonicalEvent | None: ...

    @abstractmethod
    async def list_unresolved(
        self, origin: str, since: int, before: int, limit: int
    ) -> list[CanonicalEvent]:
        """Events from `origin` that have kicked off but carry no outcome yet.

        Bounded to kickoffs in `(since, before)` — Unix ms — and to `limit` rows,
        so the results poll does a fixed amount of work per tick and fixtures
        that never reach a final status age out instead of being retried forever.
        """
        ...

    @abstractmethod
    async def list_sports(self) -> list[CanonicalSport]: ...

    @abstractmethod
    async def list_leagues(self, sport: str | None = None) -> list[CanonicalLeague]: ...
