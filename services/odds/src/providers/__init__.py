from .base import OddsProvider


def get_provider(name: str) -> OddsProvider:
    if name == "theoddsapi":
        from .theoddsapi import TheOddsApiProvider

        return TheOddsApiProvider.from_env()
    if name == "apifootball":
        from .apifootball import ApiFootballProvider

        return ApiFootballProvider.from_env()
    if name == "mock":
        from .mock import MockProvider

        return MockProvider.from_env()
    raise ValueError(
        f"Unknown odds provider {name!r}; expected one of: "
        "theoddsapi, apifootball, mock"
    )


def get_providers(names: list[str]) -> list[OddsProvider]:
    """Instantiate every enabled provider; they run concurrently at runtime."""
    return [get_provider(n) for n in names]


__all__ = ["OddsProvider", "get_provider", "get_providers"]
