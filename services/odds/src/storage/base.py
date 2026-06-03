from abc import ABC, abstractmethod
from types import TracebackType
from typing import ClassVar

from odds.models import CanonicalEvent, EventResult


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
    async def list_current(self, sport: str | None = None) -> list[CanonicalEvent]: ...

    @abstractmethod
    async def get_current(self, event_id: str) -> CanonicalEvent | None: ...
