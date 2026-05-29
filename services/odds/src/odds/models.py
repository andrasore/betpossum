from typing import Literal

from pydantic import BaseModel

Outcome = Literal["home", "away", "draw"]


class OddsEvent(BaseModel):
    event_id: str
    sport: str
    home_team: str
    away_team: str
    home_odds: float
    away_odds: float
    draw_odds: float = 0.0
    updated_at: int  # Unix ms
    outcome: Outcome | None = None
    resolved_at: int | None = None  # Unix ms


class EventResult(BaseModel):
    event_id: str
    sport: str
    outcome: Outcome
    resolved_at: int  # Unix ms
