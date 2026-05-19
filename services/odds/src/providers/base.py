from abc import ABC, abstractmethod
from typing import AsyncIterator, ClassVar

from models import OddsEvent


class OddsProvider(ABC):
    name: ClassVar[str]

    @classmethod
    @abstractmethod
    def from_env(cls) -> "OddsProvider":
        ...

    async def __aenter__(self) -> "OddsProvider":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    @abstractmethod
    def fetch_tick(self) -> AsyncIterator[OddsEvent]:
        ...
