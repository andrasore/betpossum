from .base import OddsStorage


def get_storage(name: str) -> OddsStorage:
    if name == "postgres":
        from .postgres import PostgresStorage

        return PostgresStorage.from_env()
    raise ValueError(f"Unknown ODDS_STORAGE={name!r}; expected one of: postgres")


__all__ = ["OddsStorage", "get_storage"]
