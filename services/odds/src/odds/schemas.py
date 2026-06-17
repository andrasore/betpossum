from pydantic import BaseModel, Field

from generated.rest import League, OddsEvent, Sport

from .models import (
    CanonicalEvent,
    CanonicalLeague,
    CanonicalSport,
    Outcome,
    h2h_odds,
)

# The wire shapes (`OddsEvent`/`Sport`/`League`) are generated from
# schemas/json/rest.json — the single source of truth shared with the
# frontend. These mappers project the internal canonical models onto them;
# missing canonical names stay None and the frontend falls back to the raw
# sport/team fields.


def event_to_response(event: CanonicalEvent) -> OddsEvent:
    projected = h2h_odds(event)
    home_odds, away_odds, draw_odds = (
        projected if projected is not None else (0.0, 0.0, 0.0)
    )
    return OddsEvent(
        eventId=event.event_id,
        origin=event.origin,
        sport=event.sport,
        homeTeam=event.home_team,
        awayTeam=event.away_team,
        homeOdds=home_odds,
        awayOdds=away_odds,
        drawOdds=draw_odds,
        updatedAt=event.updated_at,
        commenceTime=event.commence_time,
        outcome=event.outcome,
        resolvedAt=event.resolved_at,
        sportName=event.sport_title,
        leagueId=event.league_id,
        leagueName=event.league_name,
        homeTeamName=event.home_team_name,
        awayTeamName=event.away_team_name,
    )


def sport_to_response(sport: CanonicalSport) -> Sport:
    return Sport(slug=sport.slug, name=sport.title)


def league_to_response(league: CanonicalLeague) -> League:
    return League(id=league.id, name=league.name, sportSlug=league.sport_slug)


class ResolveEventRequest(BaseModel):
    outcome: Outcome


class ResolveEventResponse(BaseModel):
    model_config = {"populate_by_name": True}

    event_id: str = Field(serialization_alias="eventId")
    outcome: Outcome
    resolved_at: int = Field(serialization_alias="resolvedAt")
