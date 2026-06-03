"""Shared transform helpers for mapping provider payloads to the common model."""

from odds.models import Outcome


def outcome_for(name: str, home_team: str, away_team: str) -> Outcome | None:
    """Map a provider's h2h outcome label to our (home/away/draw) selection key.

    Providers label moneyline outcomes by team name (The Odds API) or by the
    literal "Home"/"Away"/"Draw" (API-Football). Handle both.
    """
    label = name.strip()
    lowered = label.lower()
    if lowered == "draw":
        return "draw"
    if lowered == "home" or label == home_team:
        return "home"
    if lowered == "away" or label == away_team:
        return "away"
    return None
