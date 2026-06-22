from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from types import TracebackType
from typing import TYPE_CHECKING, ClassVar

if TYPE_CHECKING:
    # Only needed for the abstract signatures below; aggregate is pure (no DB),
    # so this stays a type-only import to keep the ABC framework-free.
    from aggregate import SettlementRow


@dataclass(frozen=True)
class LeaderboardEntry:
    userId: str
    userName: str | None
    roiPct: float
    netProfit: float
    settledCount: int


class StatsStorage(ABC):
    name: ClassVar[str]

    @classmethod
    @abstractmethod
    def from_env(cls) -> "StatsStorage": ...

    async def __aenter__(self) -> "StatsStorage":
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
    async def record_settlement(
        self,
        *,
        bet_id: str,
        user_id: str,
        user_name: str | None,
        settled_at: int,
        stake_cents: int,
        profit_cents: int,
    ) -> None: ...

    @abstractmethod
    async def user_rows(self, user_id: str) -> list[SettlementRow]: ...

    @abstractmethod
    async def leaderboard(
        self, *, min_settled: int, limit: int
    ) -> list[LeaderboardEntry]: ...
