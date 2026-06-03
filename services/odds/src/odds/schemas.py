from pydantic import BaseModel, Field

from .models import CanonicalEvent, Outcome, h2h_odds


class OddsEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    origin: str
    sport: str
    home_team: str = Field(serialization_alias="homeTeam")
    away_team: str = Field(serialization_alias="awayTeam")
    home_odds: float = Field(serialization_alias="homeOdds")
    away_odds: float = Field(serialization_alias="awayOdds")
    draw_odds: float = Field(serialization_alias="drawOdds")
    updated_at: int = Field(serialization_alias="updatedAt")
    outcome: Outcome | None = None
    resolved_at: int | None = Field(default=None, serialization_alias="resolvedAt")
    # Canonical display names from the entity join; None when the event's
    # sport/league/team link is unresolved (the frontend falls back to the raw
    # sport/home_team/away_team above).
    sport_name: str | None = Field(default=None, serialization_alias="sportName")
    league_name: str | None = Field(default=None, serialization_alias="leagueName")
    home_team_name: str | None = Field(default=None, serialization_alias="homeTeamName")
    away_team_name: str | None = Field(default=None, serialization_alias="awayTeamName")

    @classmethod
    def from_event(cls, event: CanonicalEvent) -> "OddsEventResponse":
        projected = h2h_odds(event)
        home_odds, away_odds, draw_odds = (
            projected if projected is not None else (0.0, 0.0, 0.0)
        )
        return cls(
            event_id=event.event_id,
            origin=event.origin,
            sport=event.sport,
            home_team=event.home_team,
            away_team=event.away_team,
            home_odds=home_odds,
            away_odds=away_odds,
            draw_odds=draw_odds,
            updated_at=event.updated_at,
            outcome=event.outcome,
            resolved_at=event.resolved_at,
            sport_name=event.sport_title,
            league_name=event.league_name,
            home_team_name=event.home_team_name,
            away_team_name=event.away_team_name,
        )


class ResolveEventRequest(BaseModel):
    outcome: Outcome


class ResolveEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    outcome: Outcome
    resolved_at: int = Field(serialization_alias="resolvedAt")
