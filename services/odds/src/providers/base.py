from abc import ABC, abstractmethod
from types import TracebackType
from typing import AsyncIterator, ClassVar

from odds.models import CanonicalEvent, EventResult


class OddsProvider(ABC):
    name: ClassVar[str]

    @classmethod
    @abstractmethod
    def from_env(cls) -> "OddsProvider": ...

    async def __aenter__(self) -> "OddsProvider":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    def canonical_id(self, source_event_id: str) -> str:
        """Stable canonical id for an event from this provider.

        Events are kept separate per provider, so the canonical id is simply
        the provider name namespacing the provider's own id.
        """
        return f"{self.name}:{source_event_id}"

    @abstractmethod
    def fetch_tick(self) -> AsyncIterator[CanonicalEvent]: ...

    async def fetch_results(self) -> AsyncIterator[EventResult]:
        """Emit any newly-resolved events since the last call.

        Default is empty; providers that know about event conclusions override.
        """
        return
        yield  # pragma: no cover  — make this an async generator
