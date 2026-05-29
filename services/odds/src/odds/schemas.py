from pydantic import BaseModel, Field

from .models import OddsEvent, Outcome


class OddsEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    sport: str
    home_team: str = Field(serialization_alias="homeTeam")
    away_team: str = Field(serialization_alias="awayTeam")
    home_odds: float = Field(serialization_alias="homeOdds")
    away_odds: float = Field(serialization_alias="awayOdds")
    draw_odds: float = Field(serialization_alias="drawOdds")
    updated_at: int = Field(serialization_alias="updatedAt")
    outcome: Outcome | None = None
    resolved_at: int | None = Field(default=None, serialization_alias="resolvedAt")

    @classmethod
    def from_event(cls, event: OddsEvent) -> "OddsEventResponse":
        return cls(
            event_id=event.event_id,
            sport=event.sport,
            home_team=event.home_team,
            away_team=event.away_team,
            home_odds=event.home_odds,
            away_odds=event.away_odds,
            draw_odds=event.draw_odds,
            updated_at=event.updated_at,
            outcome=event.outcome,
            resolved_at=event.resolved_at,
        )


class ResolveEventRequest(BaseModel):
    outcome: Outcome


class ResolveEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    outcome: Outcome
    resolved_at: int = Field(serialization_alias="resolvedAt")
