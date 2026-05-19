from abc import ABC, abstractmethod
from typing import ClassVar

from models import OddsEvent


class OddsStorage(ABC):
    name: ClassVar[str]

    @classmethod
    @abstractmethod
    def from_env(cls) -> "OddsStorage":
        ...

    async def __aenter__(self) -> "OddsStorage":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def init_schema(self) -> None:
        return None

    @abstractmethod
    async def record(self, event: OddsEvent) -> None:
        ...
