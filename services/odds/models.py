from pydantic import BaseModel


class OddsEvent(BaseModel):
    event_id: str
    sport: str
    home_team: str
    away_team: str
    home_odds: float
    away_odds: float
    draw_odds: float = 0.0
    updated_at: int  # Unix ms
