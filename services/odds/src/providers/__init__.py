from .base import OddsProvider


def get_provider(name: str) -> OddsProvider:
    if name == "theoddsapi":
        from .theoddsapi import TheOddsApiProvider
        return TheOddsApiProvider.from_env()
    if name == "mock":
        from .mock import MockProvider
        return MockProvider.from_env()
    raise ValueError(
        f"Unknown ODDS_PROVIDER={name!r}; expected one of: theoddsapi, mock"
    )


__all__ = ["OddsProvider", "get_provider"]
