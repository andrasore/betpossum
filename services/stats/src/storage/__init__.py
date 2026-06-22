from .base import StatsStorage


def get_storage(name: str) -> StatsStorage:
    if name == "postgres":
        from .postgres import PostgresStorage

        return PostgresStorage.from_env()
    raise ValueError(f"Unknown STATS_STORAGE={name!r}; expected one of: postgres")


__all__ = ["StatsStorage", "get_storage"]
